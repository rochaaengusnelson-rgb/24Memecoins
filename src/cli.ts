import "dotenv/config";
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { loadEvent, totalCapacity, type EventConfig } from "./event.js";
import { burnAmount, fillRate, lamportsToSol, usdToLamports, windowEndsAt, windowOpen } from "./math.js";
import { readFeed } from "./oracle/switchboard.js";
import { uploadMetadata } from "./pumpfun/metadata.js";
import { launchOnPump, pumpUrl } from "./pumpfun/launch.js";
import { burnFromOwner, ownerBag } from "./settle.js";
import { loadState, saveState } from "./state.js";

const USAGE = `eventcoins <command> <event.json> [flags]

  quote   <event>              SOL needed for the owner's USD seed + live attendance
  launch  <event> [--dry-run] [--uri <metadataUri>]
                               upload metadata, create the coin on pump.fun, owner buys the seed
  status  <event>              window countdown, live fill rate, owner bag
  settle  <event> [--dry-run]  after the window: read final attendance, burn fill% of owner bag`;

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`missing env ${name} (see .env.example)`);
  return v;
}

const conn = () => new Connection(env("RPC_URL", "https://api.mainnet-beta.solana.com"), "confirmed");
const ownerKey = () => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(env("OWNER_KEYPAIR"), "utf8"))));
const flag = (args: string[], name: string) => args.includes(name);
const opt = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function readInputs(c: Connection, ev: EventConfig) {
  const maxPriceAge = Number(env("SB_MAX_PRICE_AGE_SEC", "120"));
  const [price, seats] = await Promise.all([
    readFeed(c, env("SB_SOL_USD_FEED"), maxPriceAge),
    readFeed(c, ev.oracle.attendanceFeed, ev.oracle.maxAgeSec),
  ]);
  const capacity = totalCapacity(ev);
  const lamports = usdToLamports(ev.funding.usd, price.value, ev.funding.slippageBps);
  return { price, seats, capacity, lamports };
}

function printVenues(ev: EventConfig) {
  for (const v of ev.venues) {
    console.log(`  - ${v.name} (${v.city}): ${v.locations} location(s), ${v.seats.toLocaleString()} seats`);
  }
  console.log(`  = ${totalCapacity(ev).toLocaleString()} seats total`);
}

async function quote(ev: EventConfig) {
  const c = conn();
  const { price, seats, capacity, lamports } = await readInputs(c, ev);
  console.log(`${ev.artist} — ${ev.title}`);
  printVenues(ev);
  console.log(`SOL/USD (Switchboard): $${price.value.toFixed(4)}`);
  console.log(`Owner seed: $${ev.funding.usd} -> ${lamportsToSol(lamports).toFixed(4)} SOL (incl. ${ev.funding.slippageBps}bps headroom)`);
  console.log(`Seats filled (Switchboard): ${Math.round(seats.value).toLocaleString()} / ${capacity.toLocaleString()} (${(fillRate(seats.value, capacity) * 100).toFixed(1)}%)`);
  console.log(`Launch gate: ${seats.value >= ev.rules.minSeatsToLaunch ? "OPEN" : `CLOSED (need ${ev.rules.minSeatsToLaunch})`}`);
}

async function launch(ev: EventConfig, args: string[]) {
  const existing = loadState(ev.id);
  if (existing) throw new Error(`event ${ev.id} already launched: ${pumpUrl(existing.mint)}`);
  const dryRun = flag(args, "--dry-run");
  const c = conn();
  const owner = ownerKey();
  const { price, seats, lamports } = await readInputs(c, ev);

  if (seats.value < ev.rules.minSeatsToLaunch) {
    throw new Error(`launch gate closed: ${Math.round(seats.value)} seats filled, need ${ev.rules.minSeatsToLaunch}`);
  }
  const balance = BigInt(await c.getBalance(owner.publicKey));
  const reserve = 50_000_000n; // ~0.05 SOL for rent (mint, curve, ATAs) + fees
  if (balance < lamports + reserve) {
    throw new Error(`owner ${owner.publicKey.toBase58()} has ${lamportsToSol(balance)} SOL, needs ~${lamportsToSol(lamports + reserve)} SOL`);
  }

  const uri = opt(args, "--uri") ?? (dryRun ? "https://example.invalid/metadata.json" : await uploadMetadata(ev));
  console.log(`metadata: ${uri}`);
  console.log(`seeding ${lamportsToSol(lamports).toFixed(4)} SOL (~$${ev.funding.usd}) from ${owner.publicKey.toBase58()}`);

  const res = await launchOnPump({
    conn: c,
    owner,
    name: ev.coin.name,
    symbol: ev.coin.symbol,
    uri,
    lamports,
    slippageBps: ev.funding.slippageBps,
    dryRun,
  });

  if (dryRun) {
    console.log(`dry run OK. would mint ${res.mint}, owner gets ~${res.expectedTokens} base units`);
    return;
  }
  saveState({
    eventId: ev.id,
    mint: res.mint,
    signature: res.signature!,
    owner: owner.publicKey.toBase58(),
    launchedAt: Math.floor(Date.now() / 1000),
    windowHours: ev.rules.windowHours,
    fundedLamports: lamports.toString(),
    solUsdAtLaunch: price.value,
    seatsAtLaunch: Math.round(seats.value),
    metadataUri: uri,
  });
  console.log(`launched: ${pumpUrl(res.mint)}\ntx: ${res.signature}`);
}

async function status(ev: EventConfig) {
  const s = loadState(ev.id);
  if (!s) throw new Error(`event ${ev.id} not launched yet`);
  const c = conn();
  const capacity = totalCapacity(ev);
  const seats = await readFeed(c, ev.oracle.attendanceFeed, ev.oracle.maxAgeSec);
  const bag = await ownerBag(c, new PublicKey(s.owner), new PublicKey(s.mint));
  const ends = windowEndsAt(s);
  const left = Math.max(0, ends - Date.now() / 1000);
  console.log(`${ev.coin.symbol}  ${pumpUrl(s.mint)}`);
  console.log(`window: ${windowOpen(s) ? `${(left / 3600).toFixed(2)}h left` : "CLOSED"} (ends ${new Date(ends * 1000).toISOString()})`);
  console.log(`seats filled: ${Math.round(seats.value).toLocaleString()} / ${capacity.toLocaleString()} (${(fillRate(seats.value, capacity) * 100).toFixed(1)}%)`);
  console.log(`owner bag: ${bag.amount} base units (${bag.decimals} decimals)`);
  if (s.settlement) console.log(`settled: burned ${s.settlement.burned} at ${(s.settlement.fillRate * 100).toFixed(1)}% fill`);
}

async function settle(ev: EventConfig, args: string[]) {
  const s = loadState(ev.id);
  if (!s) throw new Error(`event ${ev.id} not launched yet`);
  if (s.settlement) throw new Error(`already settled at ${new Date(s.settlement.settledAt * 1000).toISOString()}`);
  if (windowOpen(s)) throw new Error(`window still open until ${new Date(windowEndsAt(s) * 1000).toISOString()}`);

  const dryRun = flag(args, "--dry-run");
  const c = conn();
  const owner = ownerKey();
  if (owner.publicKey.toBase58() !== s.owner) throw new Error(`OWNER_KEYPAIR is not the launch owner ${s.owner}`);

  const capacity = totalCapacity(ev);
  const seats = await readFeed(c, ev.oracle.attendanceFeed, ev.oracle.maxAgeSec);
  const fill = fillRate(seats.value, capacity);
  const mint = new PublicKey(s.mint);
  const bag = await ownerBag(c, owner.publicKey, mint);
  const burn = burnAmount(bag.amount, fill, ev.rules.burnShareAtFullHouse);

  console.log(`final seats: ${Math.round(seats.value).toLocaleString()} / ${capacity.toLocaleString()} = ${(fill * 100).toFixed(2)}%`);
  console.log(`burning ${burn} of owner's ${bag.amount} base units`);
  if (dryRun) return;

  const sig = await burnFromOwner(c, owner, mint, burn);
  saveState({
    ...s,
    settlement: {
      settledAt: Math.floor(Date.now() / 1000),
      seatsFilled: Math.round(seats.value),
      capacity,
      fillRate: fill,
      burned: burn.toString(),
      signature: sig,
    },
  });
  console.log(sig ? `burn tx: ${sig}` : "nothing to burn");
}

async function main() {
  const [cmd, path, ...args] = process.argv.slice(2);
  if (!cmd || !path) {
    console.log(USAGE);
    process.exit(1);
  }
  const ev = loadEvent(path);
  switch (cmd) {
    case "quote":
      return quote(ev);
    case "launch":
      return launch(ev, args);
    case "status":
      return status(ev);
    case "settle":
      return settle(ev, args);
    default:
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
