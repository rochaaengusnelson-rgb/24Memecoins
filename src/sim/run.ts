/**
 * Offline simulation of a full event-coin lifecycle.
 *
 * REAL code under test: event config + validation, USD->SOL sizing, oracle staleness checks,
 * launch gate, pump.fun SDK create_v2 + buy instruction building, tx compile + signing,
 * 24h window logic, fill-rate burn math, Token-2022 burn instruction.
 *
 * MOCKED: the chain. pump.fun Global (public launch parameters), Switchboard feed values
 * (scripted timeline), wallet balance, clock. Nothing is sent anywhere.
 */
import { AddressLookupTableAccount, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PUMP_PROGRAM_ID, type Global } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import { loadEvent, totalCapacity, type EventConfig } from "../event.js";
import { burnAmount, fillRate, isStale, lamportsToSol, usdToLamports, windowEndsAt, windowOpen } from "../math.js";
import { MAX_TX_BYTES, buildLaunchIxs, compileLaunchTx, lookupTableAddresses } from "../pumpfun/launch.js";

const EVENT = process.argv[2] ?? "events/example-la-arena-nyc-broadcast.json";
const DECIMALS = 6;
const H = 3600;

// ---------- mocked chain state ----------

const pk = () => Keypair.generate().publicKey;
/** pump.fun's public launch parameters (approximate; the live program is authoritative). */
const GLOBAL: Global = {
  initialized: true,
  authority: pk(),
  feeRecipient: pk(),
  initialVirtualTokenReserves: new BN("1073000000000000"),
  initialVirtualSolReserves: new BN("30000000000"),
  initialRealTokenReserves: new BN("793100000000000"),
  tokenTotalSupply: new BN("1000000000000000"),
  feeBasisPoints: new BN(95),
  withdrawAuthority: pk(),
  enableMigrate: true,
  poolMigrationFee: new BN(15_000_001),
  creatorFeeBasisPoints: new BN(5),
  feeRecipients: Array.from({ length: 7 }, pk),
  setCreatorAuthority: pk(),
  adminSetCreatorAuthority: pk(),
  createV2Enabled: true,
  whitelistPda: pk(),
  reservedFeeRecipient: pk(),
  mayhemModeEnabled: false,
  reservedFeeRecipients: Array.from({ length: 7 }, pk),
  isCashbackEnabled: false,
  buybackFeeRecipients: [],
  buybackBasisPoints: new BN(0),
  initialVirtualQuoteReserves: new BN("30000000000"),
  whitelistedQuoteMints: [],
  creatorFeeConfigurable: false,
  maxConfigurableCreatorFeeBps: new BN(0),
  holderRewardClaimAuthority: pk(),
  isHolderRewardEnabled: false,
  maxCurveDepth: 0,
};

interface FeedPoint {
  value: number;
  updatedAt: number;
}
/** Mock Switchboard: same staleness rule as src/oracle/switchboard.ts. */
function readMockFeed(name: string, p: FeedPoint, maxAgeSec: number, now: number): number {
  if (isStale(p.updatedAt, maxAgeSec, now)) {
    throw new Error(`Switchboard feed ${name} is stale: ${Math.round(now - p.updatedAt)}s old (max ${maxAgeSec}s)`);
  }
  return p.value;
}

/** Scripted check-ins (cumulative seats filled). Hours relative to launch at showtime. */
function attendanceScript(scale: number): Array<[number, number, number]> {
  // [hour, arena, nyc theaters]
  const raw: Array<[number, number, number]> = [
    [-1, 9_200, 1_400],
    [0, 15_800, 2_900],
    [0.5, 18_100, 3_400],
    [1, 19_050, 3_650],
    [2, 19_420, 3_760],
    [3, 19_420, 3_760], // doors closed, count is final
    [24, 19_420, 3_760],
  ];
  return raw.map(([h, a, t]) => [h, Math.round(a * scale), Math.round(t * scale)]);
}

// ---------- helpers ----------

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const line = (s = "") => console.log(s);
const header = (s: string) => line(`\n=== ${s} ${"=".repeat(Math.max(0, 70 - s.length))}`);
function check(label: string, fn: () => unknown) {
  try {
    fn();
    line(`  FAIL  ${label} (expected a refusal, got none)`);
    process.exitCode = 1;
  } catch (e) {
    line(`  ok    ${label}\n        -> ${(e as Error).message}`);
  }
}

/** Constant-product on virtual reserves, as pump.fun's curve works. */
function curveAfterBuy(solInNet: bigint) {
  const vS = BigInt(GLOBAL.initialVirtualSolReserves.toString());
  const vT = BigInt(GLOBAL.initialVirtualTokenReserves.toString());
  const k = vS * vT;
  const nS = vS + solInNet;
  const nT = k / nS;
  return { tokensOut: vT - nT, vS: nS, vT: nT };
}

// ---------- scenario ----------

async function runScenario(ev: EventConfig, label: string, scale: number, solUsd: number) {
  header(`SCENARIO: ${label}`);
  const capacity = totalCapacity(ev);
  const script = attendanceScript(scale);
  const launchAt = Math.floor(Date.parse(ev.startsAt) / 1000);
  const feedAt = (hour: number): FeedPoint => {
    const t = launchAt + hour * H;
    let cur = script[0];
    for (const p of script) if (p[0] <= hour) cur = p;
    return { value: cur[1] + cur[2], updatedAt: t - 45 }; // crank posted 45s ago
  };

  const owner = Keypair.generate();
  const mint = Keypair.generate();

  // --- quote ---
  const now = launchAt;
  const price = readMockFeed("SOL/USD", { value: solUsd, updatedAt: now - 20 }, 120, now);
  const seats = readMockFeed("attendance", feedAt(0), ev.oracle.maxAgeSec, now);
  const lamports = usdToLamports(ev.funding.usd, price, ev.funding.slippageBps);
  line(`t=0h (showtime ${new Date(now * 1000).toISOString()})`);
  line(`  SOL/USD (mock Switchboard)       $${price.toFixed(2)}`);
  line(`  owner seed                       $${ev.funding.usd} -> ${lamportsToSol(lamports).toFixed(4)} SOL (incl. ${ev.funding.slippageBps}bps)`);
  line(`  seats filled at launch           ${fmt(seats)} / ${fmt(capacity)} (${pct(fillRate(seats, capacity))})`);
  line(`  launch gate (min ${fmt(ev.rules.minSeatsToLaunch)})          ${seats >= ev.rules.minSeatsToLaunch ? "OPEN" : "CLOSED"}`);

  // --- launch: real SDK instructions, real signing ---
  const balance = lamports + 80_000_000n; // mock wallet: seed + 0.08 SOL
  if (balance < lamports + 50_000_000n) throw new Error("owner underfunded");
  const fakeBlockhash = Keypair.generate().publicKey.toBase58();
  const built = await buildLaunchIxs({
    global: GLOBAL,
    feeConfig: null,
    owner: owner.publicKey,
    mint: mint.publicKey,
    name: ev.coin.name,
    symbol: ev.coin.symbol,
    // Realistic pump.fun IPFS metadata URI length
    uri: process.env.SIM_URI ?? "https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
    lamports,
    slippageBps: ev.funding.slippageBps,
  });
  const programs = [...new Set(built.ixs.map((ix) => ix.programId.toBase58()))];
  const plain = compileLaunchTx(built.ixs, owner, mint, fakeBlockhash);
  line(`  launch tx (no lookup table)      ${plain.bytes} bytes (limit ${MAX_TX_BYTES}) -> ${plain.bytes > MAX_TX_BYTES ? "TOO BIG, using lookup table" : "fits"}`);
  let final = plain;
  if (plain.bytes > MAX_TX_BYTES) {
    const addresses = lookupTableAddresses(built.ixs, [owner.publicKey, mint.publicKey]);
    // Mock of the on-chain table createLookupTable() would produce.
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0, authority: owner.publicKey, addresses },
    });
    final = compileLaunchTx(built.ixs, owner, mint, fakeBlockhash, [table]);
    line(`  launch tx (with lookup table)    ${final.bytes} bytes, ${addresses.length} addresses in table`);
  }
  if (final.bytes > MAX_TX_BYTES) throw new Error("launch tx exceeds packet size");
  line(`  signed by                        owner + mint (${final.tx.signatures.length} signatures), ${built.ixs.length} instructions, create + buy atomic`);
  line(`  programs touched                 ${programs.map((p) => (p === PUMP_PROGRAM_ID.toBase58() ? `pump(${p.slice(0, 6)}…)` : p.slice(0, 8) + "…")).join(", ")}`);
  line(`  mint                             ${mint.publicKey.toBase58()}`);

  // Curve after owner buy (net of fees)
  const feeBps = BigInt(GLOBAL.feeBasisPoints.add(GLOBAL.creatorFeeBasisPoints).toString());
  const spend = lamports - (lamports * BigInt(ev.funding.slippageBps)) / (10_000n + BigInt(ev.funding.slippageBps));
  const net = (spend * 10_000n) / (10_000n + feeBps);
  const curve = curveAfterBuy(net);
  const ownerTokens = built.quoted;
  const supply = BigInt(GLOBAL.tokenTotalSupply.toString());
  const priceSol = Number(curve.vS) / Number(curve.vT); // lamports per base unit == SOL per token
  const mcapUsd = (priceSol * Number(supply)) / 1e9 * price;
  const realTokens = BigInt(GLOBAL.initialRealTokenReserves.toString());
  line(`  owner receives (SDK quote)       ${fmt(Number(ownerTokens) / 10 ** DECIMALS)} tokens = ${pct(Number(ownerTokens) / Number(supply))} of supply for ${lamportsToSol(built.seedLamports).toFixed(4)} SOL, max spend ${lamportsToSol(lamports).toFixed(4)} SOL`);
  line(`  curve progress after seed        ${pct(Number(curve.tokensOut) / Number(realTokens))} toward graduation`);
  line(`  implied market cap               ~$${fmt(Math.round(mcapUsd))}`);

  // --- 24h window: status ticks ---
  const state = { launchedAt: launchAt, windowHours: ev.rules.windowHours };
  line(`\n  window ends ${new Date(windowEndsAt(state) * 1000).toISOString()}`);
  for (const h of [0.5, 1, 2, 6, 12, 23.9]) {
    const t = launchAt + h * H;
    const s = readMockFeed("attendance", feedAt(h), ev.oracle.maxAgeSec, t);
    line(`  status t=${String(h).padStart(4)}h  window ${windowOpen(state, t) ? "OPEN  " : "CLOSED"}  seats ${fmt(s).padStart(6)} / ${fmt(capacity)}  ${pct(fillRate(s, capacity)).padStart(6)}`);
  }

  // --- guard rails ---
  line(`\n  guard rails`);
  check("settle refused while window open (t=23.9h)", () => {
    if (windowOpen(state, launchAt + 23.9 * H)) throw new Error("window still open");
  });
  check("stale attendance feed refused (crank stopped 20 min)", () =>
    readMockFeed("attendance", { value: 1, updatedAt: launchAt + 24 * H - 1200 }, ev.oracle.maxAgeSec, launchAt + 24 * H),
  );
  check("stale SOL/USD refused at launch (5 min old)", () => readMockFeed("SOL/USD", { value: solUsd, updatedAt: now - 300 }, 120, now));
  check("launch gate closed if min seats not met", () => {
    const min = capacity; // pretend we required a full house before launch
    if (seats < min) throw new Error(`launch gate closed: ${fmt(seats)} seats filled, need ${fmt(min)}`);
  });
  check("underfunded owner refused", () => {
    const poor = lamports / 2n;
    if (poor < lamports + 50_000_000n) throw new Error(`owner has ${lamportsToSol(poor).toFixed(4)} SOL, needs ~${lamportsToSol(lamports + 50_000_000n).toFixed(4)}`);
  });

  // --- settle ---
  const tEnd = launchAt + 24 * H + 60;
  const finalSeats = readMockFeed("attendance", { ...feedAt(24), updatedAt: tEnd - 30 }, ev.oracle.maxAgeSec, tEnd);
  const fill = fillRate(finalSeats, capacity);
  const burn = burnAmount(ownerTokens, fill, ev.rules.burnShareAtFullHouse);
  const ata = getAssociatedTokenAddressSync(mint.publicKey, owner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const burnTx = new Transaction().add(
    createBurnCheckedInstruction(ata, mint.publicKey, owner.publicKey, burn, DECIMALS, [], TOKEN_2022_PROGRAM_ID),
  );
  burnTx.recentBlockhash = fakeBlockhash;
  burnTx.feePayer = owner.publicKey;
  burnTx.sign(owner);
  line(`\nt=24h+1m  SETTLE`);
  line(`  final seats (mock Switchboard)   ${fmt(finalSeats)} / ${fmt(capacity)} = ${pct(fill)}`);
  line(`  burn                             ${fmt(Number(burn) / 10 ** DECIMALS)} of ${fmt(Number(ownerTokens) / 10 ** DECIMALS)} owner tokens (${pct(Number(burn) / Number(ownerTokens))})`);
  line(`  owner keeps                      ${fmt(Number(ownerTokens - burn) / 10 ** DECIMALS)} tokens`);
  line(`  supply after burn                ${pct(Number(supply - burn) / Number(supply))} of original`);
  line(`  burn tx built + signed           ${burnTx.serialize().length} bytes, Token-2022 burnChecked`);
}

async function main() {
  const ev = loadEvent(EVENT);
  header("EVENT");
  line(`${ev.artist} — ${ev.title}`);
  for (const v of ev.venues) line(`  - ${v.name} (${v.city}): ${v.locations} location(s), ${fmt(v.seats)} seats`);
  line(`  = ${fmt(totalCapacity(ev))} seats   window ${ev.rules.windowHours}h   seed $${ev.funding.usd}`);
  line(`  attendance feed ${ev.oracle.attendanceFeed}  (mocked)`);

  await runScenario(ev, "near sell-out, SOL $185", 1, 185);
  await runScenario(ev, "soft night (60% of script), SOL $140", 0.6, 140);
  header("DONE");
  line("Chain was mocked: nothing was uploaded, simulated against a validator, or sent.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
