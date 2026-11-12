/**
 * Live dry run: build the real launch against the live pump.fun program (mainnet or devnet)
 * and run it through Solana's simulateTransaction. No keys, no SOL, nothing is sent.
 *
 * simulateTransaction is called with sigVerify: false, so the transaction is simulated as if a
 * stand-in wallet (any funded system account taken from a recent block) were the event owner.
 * The pump.fun program executes for real: create_v2, ATA creation, the first buy, fees.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_PROGRAM_ID } from "@pump-fun/pump-sdk";
import { launchTime, loadEvent, totalCapacity } from "./event.js";
import { burnAmount, fillRate, isStale, lamportsToSol, usdToLamports } from "./math.js";
import { feedAgeSec, isPubkey, loadFeed, readFeed } from "./oracle/switchboard.js";
import { MAX_TX_BYTES, buildLaunchIxs, compileUnsigned } from "./pumpfun/launch.js";

const RPC = {
  mainnet: process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  devnet: process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com",
} as const;
type Net = keyof typeof RPC;

// Realistic pump.fun IPFS metadata URI (used when --uri is not given; upload is not part of a dry run).
const SAMPLE_URI = "https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const line = (s = "") => console.log(s);
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * A funded plain wallet to stand in for the owner during simulation: the fee payer of a recent
 * pump.fun transaction (cheap RPC calls, works on rate-limited public endpoints).
 */
async function findStandIn(conn: Connection, minLamports: bigint): Promise<PublicKey> {
  const sigs = await conn.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit: 40 });
  const seen = new Set<string>();
  for (const s of sigs.filter((x) => !x.err).slice(0, 15)) {
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
    const payer = tx?.transaction.message.staticAccountKeys[0];
    if (!payer || seen.has(payer.toBase58())) continue;
    seen.add(payer.toBase58());
    const a = await conn.getAccountInfo(payer);
    if (a && a.owner.equals(SystemProgram.programId) && a.data.length === 0 && BigInt(a.lamports) > minLamports) return payer;
  }
  throw new Error("no funded stand-in wallet found among recent pump.fun traders; pass --payer <pubkey>");
}

function tokenAmount(data: Buffer | null | undefined): bigint {
  return data && data.length >= 72 ? data.readBigUInt64LE(64) : 0n;
}

async function main() {
  const eventPath = args.find((a) => a.endsWith(".json"));
  if (!eventPath) {
    line("usage: npm run dryrun -- <event.json> [--network mainnet|devnet] [--sol-usd N] [--seats N] [--final-seats N] [--payer PUBKEY] [--uri URI]");
    process.exit(1);
  }
  const net = (opt("--network") ?? "mainnet") as Net;
  if (!(net in RPC)) throw new Error(`--network must be mainnet or devnet`);
  const ev = loadEvent(eventPath);
  const conn = new Connection(RPC[net], "confirmed");
  const mainnet = net === "mainnet" ? conn : new Connection(RPC.mainnet, "confirmed");
  const capacity = totalCapacity(ev);
  const report: Record<string, unknown> = { event: ev.id, network: net, at: new Date().toISOString() };

  line(`DRY RUN on ${net.toUpperCase()}: ${ev.artist}, ${ev.title}`);
  line(`  venues: ${ev.venues.map((v) => `${v.name} ${fmt(v.seats)}`).join(" + ")} = ${fmt(capacity)} seats`);
  const et = (ms: number) =>
    new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const start = Date.parse(launchTime(ev));
  const show = Date.parse(ev.startsAt);
  const windowEnd = start + ev.rules.windowHours * 3600_000;
  line(`  timeline (ET):`);
  line(`    ${et(start).padEnd(28)} coin goes live at 0 seats, ${ev.rules.windowHours}h window opens`);
  if (show !== start) line(`    ${et(show).padEnd(28)} show starts (${((show - start) / 3600_000).toFixed(1)}h after launch)`);
  if (ev.endsAt) line(`    ${et(Date.parse(ev.endsAt)).padEnd(28)} headliner ends (${((Date.parse(ev.endsAt) - show) / 3600_000).toFixed(1)}h show); crowd leaves`);
  line(`    ${et(windowEnd).padEnd(28)} window closes, settle: burn by final fill`);
  report.timeline = { launch: new Date(start).toISOString(), showStarts: ev.startsAt, showEnds: ev.endsAt ?? null, windowCloses: new Date(windowEnd).toISOString() };

  // ---- 1. Switchboard SOL/USD ----
  line(`\n[1] Switchboard SOL/USD`);
  const sbFeed = opt("--sb-feed") ?? process.env.SB_SOL_USD_FEED;
  const maxAge = Number(process.env.SB_MAX_PRICE_AGE_SEC ?? 120);
  const override = opt("--sol-usd");
  let solUsd: number;
  if (sbFeed) {
    const r = await loadFeed(mainnet, sbFeed);
    const stale = isStale(r.updatedAt, maxAge);
    line(`  feed ${sbFeed} "${r.name}": $${r.value.toFixed(3)}, updated ${fmt(feedAgeSec(r))}s ago ${stale ? `(STALE > ${maxAge}s)` : "(fresh)"}`);
    report.switchboardPrice = { ...r, stale };
    if (!stale) solUsd = r.value;
    else if (override) {
      solUsd = Number(override);
      line(`  using --sol-usd $${solUsd} because the feed is stale (a real launch would refuse here)`);
    } else throw new Error("SOL/USD feed is stale. Crank it, or pass --sol-usd for a dry run.");
  } else if (override) {
    solUsd = Number(override);
    line(`  no SB_SOL_USD_FEED set; using --sol-usd $${solUsd}`);
  } else throw new Error("set SB_SOL_USD_FEED (or --sb-feed), or pass --sol-usd");
  report.solUsd = solUsd;

  // ---- 2. Switchboard attendance ----
  line(`\n[2] Switchboard attendance`);
  let seats: number;
  const seatsOverride = opt("--seats");
  if (isPubkey(ev.oracle.attendanceFeed)) {
    try {
      seats = (await readFeed(mainnet, ev.oracle.attendanceFeed, ev.oracle.maxAgeSec)).value;
      line(`  feed ${ev.oracle.attendanceFeed}: ${fmt(seats)} seats`);
    } catch (e) {
      if (!seatsOverride) throw e;
      seats = Number(seatsOverride);
      line(`  feed unreadable (${(e as Error).message}); using --seats ${fmt(seats)}`);
    }
  } else {
    if (!seatsOverride) throw new Error(`event has no attendance feed yet (${ev.oracle.attendanceFeed}); pass --seats N`);
    seats = Number(seatsOverride);
    line(`  no feed configured yet; using --seats ${fmt(seats)}`);
  }
  const fill = fillRate(seats, capacity);
  line(`  fill ${fmt(seats)} / ${fmt(capacity)} = ${pct(fill)}; launch gate (min ${fmt(ev.rules.minSeatsToLaunch)}) ${seats >= ev.rules.minSeatsToLaunch ? "OPEN" : "CLOSED"}`);
  report.seats = seats;
  const finalSeats = opt("--final-seats") ? Number(opt("--final-seats")) : seats;
  const finalFill = fillRate(finalSeats, capacity);
  if (opt("--final-seats")) line(`  final count (after the show, --final-seats) ${fmt(finalSeats)} / ${fmt(capacity)} = ${pct(finalFill)}`);
  report.finalSeats = finalSeats;

  // ---- 3. Seed sizing against the live curve ----
  line(`\n[3] Owner seed`);
  const online = new OnlinePumpSdk(conn);
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
  let lamports = usdToLamports(ev.funding.usd, solUsd, ev.funding.slippageBps);
  line(`  $${ev.funding.usd} at $${solUsd} = ${lamportsToSol(lamports).toFixed(4)} SOL (incl. ${ev.funding.slippageBps}bps)`);
  if (net === "devnet") {
    const mg = await new OnlinePumpSdk(mainnet).fetchGlobal();
    const scaled = (lamports * BigInt(global.initialVirtualSolReserves.toString())) / BigInt(mg.initialVirtualSolReserves.toString());
    line(`  devnet curve is ${lamportsToSol(BigInt(global.initialVirtualSolReserves.toString()))} vSOL vs mainnet ${lamportsToSol(BigInt(mg.initialVirtualSolReserves.toString()))}: scaled seed to ${lamportsToSol(scaled).toFixed(6)} SOL (same share of the curve)`);
    lamports = scaled;
  }
  report.seedLamports = lamports.toString();

  // ---- 4. Build the real launch ----
  line(`\n[4] Build create_v2 + first buy (live pump.fun Global + FeeConfig from ${net})`);
  const payer = opt("--payer") ? new PublicKey(opt("--payer")!) : await findStandIn(conn, lamports + 1_000_000_000n);
  const mint = Keypair.generate().publicKey;
  let uri = opt("--uri") ?? SAMPLE_URI;
  const built = await buildLaunchIxs({ global, feeConfig, owner: payer, mint, name: ev.coin.name, symbol: ev.coin.symbol, uri, lamports, slippageBps: ev.funding.slippageBps });
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  let { tx, bytes } = compileUnsigned(built.ixs, payer, blockhash);
  line(`  stand-in owner ${payer.toBase58()} (simulation only, sigVerify off)`);
  line(`  mint ${mint.toBase58()}`);
  line(`  SDK quote: ${fmt(Number(built.quoted) / 1e6)} tokens; for ${lamportsToSol(built.seedLamports).toFixed(4)} SOL (max spend ${lamportsToSol(lamports).toFixed(4)} SOL)`);
  line(`  tx size with real-length URI: ${bytes} bytes ${bytes > MAX_TX_BYTES ? `> ${MAX_TX_BYTES}: a real launch creates a lookup table first` : "fits"}`);
  report.txBytes = bytes;
  if (bytes > MAX_TX_BYTES) {
    // Lookup tables must exist on chain to simulate with them, so shorten the URI just for the simulation.
    uri = "ipfs://" + "Q".repeat(Math.max(1, uri.length - (bytes - MAX_TX_BYTES) - 12));
    const again = await buildLaunchIxs({ global, feeConfig, owner: payer, mint, name: ev.coin.name, symbol: ev.coin.symbol, uri, lamports, slippageBps: ev.funding.slippageBps });
    ({ tx, bytes } = compileUnsigned(again.ixs, payer, blockhash));
    line(`  simulating with a ${uri.length}-char URI so it fits without a lookup table (${bytes} bytes)`);
  }

  // ---- 5. Simulate ----
  line(`\n[5] simulateTransaction on ${net}`);
  const ata22 = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_2022_PROGRAM_ID);
  const ataLegacy = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_PROGRAM_ID);
  const pre = BigInt(await conn.getBalance(payer));
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: [ata22.toBase58(), ataLegacy.toBase58(), payer.toBase58(), mint.toBase58()] },
  });
  const logs = sim.value.logs ?? [];
  const ixLogs = logs.filter((l) => /Instruction: |failed|error/i.test(l)).map((l) => l.replace("Program log: ", ""));
  line(`  result: ${sim.value.err ? `FAILED ${JSON.stringify(sim.value.err)}` : "SUCCESS"}`);
  line(`  compute units: ${fmt(sim.value.unitsConsumed ?? 0)} / 400,000 requested`);
  line(`  instructions executed: ${[...new Set(ixLogs)].join(" → ")}`);
  report.simulation = { err: sim.value.err, unitsConsumed: sim.value.unitsConsumed, logs };
  if (sim.value.err) {
    line(logs.slice(-15).map((l) => "    " + l).join("\n"));
    save(report);
    process.exitCode = 1;
    return;
  }
  const accts = sim.value.accounts ?? [];
  const got22 = tokenAmount(accts[0]?.data ? Buffer.from(accts[0].data[0], "base64") : null);
  const gotLegacy = tokenAmount(accts[1]?.data ? Buffer.from(accts[1].data[0], "base64") : null);
  const received = got22 || gotLegacy;
  const tokenProgram = got22 ? "Token-2022" : gotLegacy ? "SPL Token" : "unknown";
  const post = accts[2]?.lamports != null ? BigInt(accts[2].lamports) : pre;
  const mintOwner = accts[3]?.owner ?? "?";
  const supply = BigInt(global.tokenTotalSupply.toString());
  line(`  mint created, owned by ${mintOwner === TOKEN_2022_PROGRAM_ID.toBase58() ? "Token-2022" : mintOwner}`);
  line(`  owner received ${fmt(Number(received) / 1e6)} tokens (${tokenProgram}) = ${pct(Number(received) / Number(supply))} of supply`);
  line(`  owner SOL out: ${lamportsToSol(pre - post).toFixed(6)} (seed + fees + rent for mint, curve, ATAs)`);
  report.received = received.toString();
  report.solOut = (pre - post).toString();

  // ---- 6. Settlement projection ----
  const burn = burnAmount(received, finalFill, ev.rules.burnShareAtFullHouse);
  line(`\n[6] Settlement after ${ev.rules.windowHours}h at ${pct(finalFill)} fill (${fmt(finalSeats)} seats)`);
  line(`  burn ${fmt(Number(burn) / 1e6)} of ${fmt(Number(received) / 1e6)} owner tokens; owner keeps ${fmt(Number(received - burn) / 1e6)}`);
  report.burn = burn.toString();

  save(report);
}

function save(report: Record<string, unknown>) {
  mkdirSync("state/dryrun", { recursive: true });
  const f = `state/dryrun/${report.event}-${report.network}-${Date.now()}.json`;
  writeFileSync(f, JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  line(`\nreport: ${f}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
