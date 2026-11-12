/**
 * ROI scenarios for an event coin whose price is pegged 1:1 to seats occupied.
 *
 * Peg: price(t) = price at launch (right after the owner's seed buy) x seats(t) / seats(launch).
 * Each minute, the crowd buys or sells on the real pump.fun curve math (live mainnet Global +
 * fee rates) exactly enough to hold that peg. Owner exits are market sells into the curve; the
 * crowd re-pegs immediately after, and the report shows what that costs them.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import {
  OnlinePumpSdk,
  computeFeesBps,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
  newBondingCurve,
  type FeeConfig,
  type Global,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import { loadEvent, totalCapacity, type EventConfig } from "./event.js";
import { burnAmount, usdToLamports } from "./math.js";
import { Curve, seatsAt } from "./model/curve.js";

const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const RENT_SOL = 0.0092; // mint + curve + ATA rent, from the mainnet dry run (2.711916 out - 2.7027 seed)
const DEC = 1e6;

interface Sell {
  minute: number;
  fraction: number; // of the owner's tokens held at that moment
  label: string;
}
interface Scenario {
  id: string;
  name: string;
  sells: Sell[];
  burn: boolean;
}

interface Result {
  sc: Scenario;
  seedGross: bigint;
  ownerTokens0: bigint;
  sells: Array<Sell & { tokens: bigint; solNet: bigint; pricePeg: number; priceAfter: number; crowdRepeg: bigint }>;
  burned: bigint;
  residualTokens: bigint;
  residualValue: bigint;
  creatorFees: bigint;
  crowdIn: bigint;
  crowdOut: bigint;
  crowdTokensEnd: bigint;
  crowdResidualValue: bigint;
  rows: Array<{ minute: number; seats: number; peg: number; price: number; ownerTokens: bigint; crowdNet: bigint }>;
}

const sol = (l: bigint | number) => Number(l) / 1e9;
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const tok = (t: bigint) => (Number(t) / DEC).toLocaleString("en-US", { maximumFractionDigits: 0 });

function etClock(startIso: string, minute: number) {
  return new Date(Date.parse(startIso) + minute * 60_000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function liveParams(): Promise<{ global: Global; feeConfig: FeeConfig | null; source: string }> {
  const url = process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const sdk = new OnlinePumpSdk(new Connection(url, "confirmed"));
  const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
  return { global, feeConfig, source: `live mainnet (${new Date().toISOString()})` };
}

function run(ev: EventConfig, g: Global, fc: FeeConfig | null, solUsd: number, sc: Scenario, windowMin: number): Result {
  const points = ev.attendanceProfile!.points as Array<[number, number]>;
  const capacity = totalCapacity(ev);
  const supply = BigInt(g.tokenTotalSupply.toString());
  const init = {
    vS: BigInt(g.initialVirtualSolReserves.toString()),
    vT: BigInt(g.initialVirtualTokenReserves.toString()),
    realT: BigInt(g.initialRealTokenReserves.toString()),
  };
  const f = computeFeesBps({ global: g, feeConfig: fc, mintSupply: g.tokenTotalSupply, virtualQuoteReserves: g.initialVirtualSolReserves, virtualTokenReserves: g.initialVirtualTokenReserves });
  const curve = new Curve(init, { protocol: BigInt(f.protocolFeeBps.toString()), creator: BigInt(f.creatorFeeBps.toString()) });

  // Owner seed: same sizing as launch (quote for the $ seed; headroom only caps max spend).
  const seedGross = usdToLamports(ev.funding.usd, solUsd, 0);
  let ownerTokens = curve.buyGross(seedGross).tokens;
  const ownerTokens0 = ownerTokens;
  curve.creatorFees = 0n; // creator fees on the owner's own buy are paid by the owner; count only others'
  const pLaunch = curve.price();
  const seats0 = points[0][1];
  const peakSeats = Math.max(...points.map((p) => p[1]));

  let crowdTokens = 0n;
  let crowdIn = 0n;
  let crowdOut = 0n;
  const sellsOut: Result["sells"] = [];
  const rows: Result["rows"] = [];

  const repeg = (peg: number) => {
    const target = curve.vSForPrice(peg);
    if (target > curve.vS) {
      const t = curve.buyNet(target - curve.vS);
      crowdTokens += t.tokens;
      crowdIn += t.solGross;
      return t.solGross;
    }
    if (target < curve.vS && crowdTokens > 0n) {
      const need = (curve.k + target - 1n) / target - curve.vT;
      const amt = need < crowdTokens ? need : crowdTokens;
      if (amt > 0n) {
        const t = curve.sell(amt);
        crowdTokens -= amt;
        crowdOut += t.solNet;
      }
    }
    return 0n;
  };

  for (let m = 1; m <= windowMin; m++) {
    const seats = seatsAt(points, m);
    const peg = (pLaunch * seats) / seats0;
    repeg(peg);
    for (const s of sc.sells.filter((x) => x.minute === m)) {
      const amt = s.fraction >= 1 ? ownerTokens : (ownerTokens * BigInt(Math.round(s.fraction * 10_000))) / 10_000n;
      if (amt <= 0n) continue;
      const t = curve.sell(amt);
      ownerTokens -= amt;
      const priceAfter = curve.price();
      const absorbed = repeg(peg); // crowd buys the dump back to the peg
      sellsOut.push({ ...s, tokens: amt, solNet: t.solNet, pricePeg: peg, priceAfter, crowdRepeg: absorbed });
    }
    if (m % 5 === 0 || m === 1) rows.push({ minute: m, seats: Math.round(seats), peg, price: curve.price(), ownerTokens, crowdNet: crowdOut - crowdIn });
  }

  let burned = 0n;
  if (sc.burn && ownerTokens > 0n) {
    burned = burnAmount(ownerTokens, Math.min(1, peakSeats / capacity), ev.rules.burnShareAtFullHouse);
    ownerTokens -= burned;
  }
  const residualValue = ownerTokens > 0n ? curve.quoteSell(ownerTokens) : 0n;
  const crowdResidualValue = crowdTokens > 0n ? curve.quoteSell(crowdTokens) : 0n;
  void supply;
  return {
    sc,
    seedGross,
    ownerTokens0,
    sells: sellsOut,
    burned,
    residualTokens: ownerTokens,
    residualValue,
    creatorFees: curve.creatorFees,
    crowdIn,
    crowdOut,
    crowdTokensEnd: crowdTokens,
    crowdResidualValue,
    rows,
  };
}

async function main() {
  const path = args.find((a) => a.endsWith(".json")) ?? "events/msg-nyc-one-night.json";
  const ev = loadEvent(path);
  if (!ev.attendanceProfile) throw new Error(`${path} has no attendanceProfile`);
  const solUsd = Number(opt("--sol-usd") ?? 185);
  const { global: g, feeConfig: fc, source } = await liveParams();
  const capacity = totalCapacity(ev);
  const start = ev.startsAt;
  const showMin = ev.endsAt ? Math.round((Date.parse(ev.endsAt) - Date.parse(start)) / 60_000) : 210;
  const windowMin = Math.round(ev.rules.windowHours * 60);
  const mid = Math.round(showMin / 2);
  const beforeLeave = showMin - 5;
  const points = ev.attendanceProfile.points as Array<[number, number]>;
  const peakSeats = Math.max(...points.map((p) => p[1]));

  // --- cross-check the curve model against the SDK ---
  const check = new Curve(
    { vS: BigInt(g.initialVirtualSolReserves.toString()), vT: BigInt(g.initialVirtualTokenReserves.toString()), realT: BigInt(g.initialRealTokenReserves.toString()) },
    (() => {
      const f = computeFeesBps({ global: g, feeConfig: fc, mintSupply: g.tokenTotalSupply, virtualQuoteReserves: g.initialVirtualSolReserves, virtualTokenReserves: g.initialVirtualTokenReserves });
      return { protocol: BigInt(f.protocolFeeBps.toString()), creator: BigInt(f.creatorFeeBps.toString()) };
    })(),
  );
  const seed = usdToLamports(ev.funding.usd, solUsd, 0);
  const modelBuy = check.buyGross(seed).tokens;
  const sdkBuy = BigInt(getBuyTokenAmountFromSolAmount({ global: g, feeConfig: fc, mintSupply: null, bondingCurve: null, amount: new BN(seed.toString()), quoteMint: NATIVE_MINT }).toString());
  const bc = newBondingCurve(g);
  bc.creator = Keypair.generate().publicKey; // a curve with a creator pays the creator fee, as the event coin does
  bc.virtualQuoteReserves = new BN(check.vS.toString());
  bc.virtualTokenReserves = new BN(check.vT.toString());
  bc.realQuoteReserves = new BN(check.realSol.toString());
  bc.realTokenReserves = new BN(check.realTokensLeft.toString());
  const sdkSell = BigInt(getSellSolAmountFromTokenAmount({ global: g, feeConfig: fc, mintSupply: g.tokenTotalSupply, bondingCurve: bc, amount: new BN(modelBuy.toString()) }).toString());
  const modelSell = check.quoteSell(modelBuy);
  const relErr = (a: bigint, b: bigint) => Math.abs(Number(a - b)) / Number(b);

  const scenarios: Scenario[] = [
    { id: "A", name: `Owner sells 100% mid-show (${etClock(start, mid)})`, sells: [{ minute: mid, fraction: 1, label: "mid-show" }], burn: true },
    { id: "B", name: `Owner sells 100% right before the crowd leaves (${etClock(start, beforeLeave)})`, sells: [{ minute: beforeLeave, fraction: 1, label: "before crowd leaves" }], burn: true },
    { id: "C", name: `Owner sells 50% mid-show, 50% before the crowd leaves`, sells: [{ minute: mid, fraction: 0.5, label: "mid-show" }, { minute: beforeLeave, fraction: 1, label: "before crowd leaves" }], burn: true },
    { id: "D", name: "Owner holds; settlement burn at peak fill (baseline rules)", sells: [], burn: true },
    { id: "E", name: "Owner holds, no burn; sells at window close (reference)", sells: [{ minute: windowMin, fraction: 1, label: "window close" }], burn: false },
  ];
  const results = scenarios.map((sc) => run(ev, g, fc, solUsd, sc, windowMin));

  const supply = Number(g.tokenTotalSupply.toString());
  const mcap = (p: number) => (p * supply * solUsd) / 1e9;
  const r0 = results[0];
  const pLaunch = r0.rows.length ? (r0.rows[0].peg * points[0][1]) / seatsAt(points, 1) : 0;

  // ---- report ----
  const L: string[] = [];
  const w = (s = "") => L.push(s);
  w(`# ROI report: ${ev.title}`);
  w();
  w(`${ev.artist} · ${etClock(start, 0)} – ${etClock(start, showMin)} ET · ${capacity.toLocaleString()} seats · $${ev.funding.usd} owner seed · ${ev.rules.windowHours}h coin window`);
  w();
  w(`Generated ${new Date().toISOString()} · SOL/USD **$${solUsd}** (held constant) · pump.fun parameters: ${source}`);
  w();
  w(`## How price is tied to attendance`);
  w();
  w(`- **Peg (1:1):** coin price = launch price × seats occupied ÷ ${points[0][1].toLocaleString()} (seats at launch). +1% seats → +1% price, −1% seats → −1% price.`);
  w(`- Launch price is set by the owner's $${ev.funding.usd} buy on a fresh pump.fun curve: **${usd(mcap(pLaunch))} market cap**. At the ${peakSeats.toLocaleString()}-seat peak (${(peakSeats / capacity * 100).toFixed(1)}% full) the peg is ${pct(peakSeats / points[0][1] - 1)}: **${usd(mcap(pLaunch * peakSeats / points[0][1]))}**.`);
  w(`- Every minute, the crowd buys or sells on the real curve exactly enough to hold the peg. This is the model's assumption; on pump.fun, price is set by whoever trades. Holding a 1:1 peg in production needs a market maker or program that trades against the Switchboard attendance feed.`);
  w(`- Seats are **occupancy** (people in the building), so price falls as the crowd leaves. The pump.fun curve can't trade below the price where every holder but the owner has sold, so after the venue empties the price sits at that floor rather than at $0.`);
  w(`- Fees: ${check.fees.protocol} bps protocol + ${check.fees.creator} bps creator on every trade (live). The owner is the coin creator and earns the creator fee on all crowd volume.`);
  w(`- Curve model checked against the pump.fun SDK: first buy ${tok(modelBuy)} vs SDK ${tok(sdkBuy)} tokens (${(relErr(modelBuy, sdkBuy) * 100).toFixed(4)}% diff); selling that bag ${sol(modelSell).toFixed(6)} vs SDK ${sol(sdkSell).toFixed(6)} SOL (${(relErr(modelSell, sdkSell) * 100).toFixed(4)}% diff).`);
  w();
  w(`## Attendance → price (peg)`);
  w();
  w(`| Time (ET) | Seats occupied | Fill | Peg vs launch | Market cap at peg |`);
  w(`|---|---:|---:|---:|---:|`);
  for (const [m] of [[0], [20], [60], [mid], [beforeLeave], [showMin], [showMin + 10], [showMin + 20], [showMin + 30], [showMin + 60]] as Array<[number]>) {
    const s = seatsAt(points, m);
    w(`| ${etClock(start, m)}${m === mid ? " (mid-show)" : m === beforeLeave ? " (before crowd leaves)" : m === showMin ? " (headliner ends)" : m === 0 ? " (launch)" : ""} | ${Math.round(s).toLocaleString()} | ${(s / capacity * 100).toFixed(1)}% | ${pct(s / points[0][1] - 1)} | ${usd(mcap(pLaunch * s / points[0][1]))} |`);
  }
  w();
  w(`## Owner ROI by scenario`);
  w();
  w(`Owner cost: ${sol(r0.seedGross).toFixed(4)} SOL seed (${usd(ev.funding.usd)}) + ${RENT_SOL} SOL account rent = **${usd((sol(r0.seedGross) + RENT_SOL) * solUsd)}**. The owner bag is ${tok(r0.ownerTokens0)} tokens (${(Number(r0.ownerTokens0) / supply * 100).toFixed(2)}% of supply).`);
  w();
  w(`| | Scenario | Sale proceeds | Creator fees | Bag left (value) | Owner total | **Owner ROI** | Crowd net |`);
  w(`|---|---|---:|---:|---:|---:|---:|---:|`);
  const summary: Array<Record<string, string | number>> = [];
  for (const r of results) {
    const cost = sol(r.seedGross) + RENT_SOL;
    const proceeds = r.sells.reduce((a, s) => a + sol(s.solNet), 0);
    const fees = sol(r.creatorFees);
    const resid = sol(r.residualValue);
    const total = proceeds + fees + resid;
    const roi = total / cost - 1;
    const crowd = sol(r.crowdOut - r.crowdIn + r.crowdResidualValue);
    summary.push({ id: r.sc.id, scenario: r.sc.name, costSol: cost, proceedsSol: proceeds, creatorFeesSol: fees, residualSol: resid, totalSol: total, roi, crowdNetSol: crowd, burnedTokens: tok(r.burned) });
    w(`| ${r.sc.id} | ${r.sc.name} | ${usd(proceeds * solUsd)} | ${usd(fees * solUsd)} | ${r.residualTokens > 0n ? `${tok(r.residualTokens)} (${usd(resid * solUsd)})` : "—"} | ${usd(total * solUsd)} | **${pct(roi)}** (${usd((total - cost) * solUsd)}) | ${usd(crowd * solUsd)} |`);
  }
  w();
  w(`"Crowd net" is what everyone else, all buyers together, ends with: SOL out − SOL in + the value of tokens still held. The owner's exit, every fee and the crowd's P&L account for all the SOL that moved.`);
  w();
  w(`## What each owner sale does to the price`);
  w();
  w(`| | Sale | Time (ET) | Tokens sold | Proceeds | Price drop vs peg | Crowd SOL to restore the peg |`);
  w(`|---|---|---|---:|---:|---:|---:|`);
  for (const r of results) {
    for (const s of r.sells) {
      w(`| ${r.sc.id} | ${s.label} | ${etClock(start, s.minute)} | ${tok(s.tokens)} | ${usd(sol(s.solNet) * solUsd)} | ${s.pricePeg > 0 ? pct(s.priceAfter / s.pricePeg - 1) : "n/a (peg is $0, venue empty)"} | ${s.crowdRepeg > 0n ? usd(sol(s.crowdRepeg) * solUsd) : "— (venue empty, no peg left to defend)"} |`);
    }
  }
  w();
  w(`## Settlement`);
  w();
  for (const r of results) {
    if (r.sc.burn) {
      w(`- **${r.sc.id}:** ${r.burned > 0n ? `burns ${tok(r.burned)} tokens (${(peakSeats / capacity * 100).toFixed(1)}% peak fill × ${ev.rules.burnShareAtFullHouse}); owner keeps ${tok(r.residualTokens)}.` : "nothing to burn: the owner already sold the whole bag, so holders don't get the attendance burn."}`);
    }
  }
  w();
  w(`## Takeaways`);
  w();
  const [A, B, C, D, E] = summary;
  const cSells = results[2].sells;
  w(`1. **A 1:1 peg caps the price.** Seats can only rise from ${points[0][1].toLocaleString()} at launch to ${capacity.toLocaleString()} (${pct(capacity / points[0][1] - 1)} max). This show peaks at ${pct(peakSeats / points[0][1] - 1)}. Every trade pays about ${Number(check.totalFeeBps)} bps in fees.`);
  w(`2. **Mid-show (A) and just before the crowd leaves (B) pay the same: ${pct(Number(A.roi))}.** Occupancy is flat at ${peakSeats.toLocaleString()} from ${etClock(start, 60)} until ${etClock(start, beforeLeave)}, so both sales hit the same peg price. The window to sell closes at ${etClock(start, showMin)}: ten minutes later the peg is down ${pct(seatsAt(points, showMin + 10) / peakSeats - 1).replace("-", "")} from peak.`);
  w(`3. **Splitting the exit (C) beats one dump: ${pct(Number(C.roi))} vs ${pct(Number(A.roi))}.** Each half moves the price ${pct(cSells[0].priceAfter / cSells[0].pricePeg - 1)} instead of ${pct(results[0].sells[0].priceAfter / results[0].sells[0].pricePeg - 1)}. Buyers restore the peg between the sales, so the second half also sells at the peak. That extra gain comes from the crowd (crowd net ${usd(Number(C.crowdNetSol) * solUsd)} vs ${usd(Number(A.crowdNetSol) * solUsd)}).`);
  w(`4. **Holding under the burn rule (D) costs the owner ${pct(Number(D.roi))}.** That is the design: the seed pays for a burn that rewards holders. Without a burn (E), the owner exits at ${pct(Number(E.roi))} after the venue empties: fees, offset by creator-fee income.`);
  w(`5. **An owner sale breaks the attendance peg and removes the burn.** The owner holds ${(Number(r0.ownerTokens0) / supply * 100).toFixed(1)}% of supply. In A–C the price drops below the peg until buyers spend ${usd(sol(results[0].sells[0].crowdRepeg) * solUsd)} to restore it, and settlement has nothing left to burn. If owners can sell, say so up front, or lock the owner bag in an escrow that only settlement can release.`);
  w();
  w(`## Assumptions`);
  w();
  w(`- Attendance is the modeled occupancy profile in \`${path}\`; it has to come from a real Switchboard feed (door scans / exits) before launch.`);
  w(`- SOL/USD stays at $${solUsd} throughout. No other traders, bots or snipers: crowd trades are exactly what holds the peg.`);
  w(`- The settlement burn uses peak occupancy (${peakSeats.toLocaleString()}), the event's attendance count, because occupancy is 0 by the time the window closes.`);
  w(`- Creator fees are counted on crowd trades only, and claimable by the owner whether or not they sold.`);
  w(`- Not financial advice. This models one rule set; real markets won't hold a peg on their own.`);

  mkdirSync("reports", { recursive: true });
  const base = `reports/${ev.id}-roi`;
  writeFileSync(`${base}.md`, L.join("\n") + "\n");
  const csv = ["scenario,time_et,minute,seats,peg_mcap_usd,price_mcap_usd,owner_tokens,crowd_net_sol"];
  for (const r of results) for (const row of r.rows) csv.push([r.sc.id, `"${etClock(start, row.minute)}"`, row.minute, row.seats, mcap(row.peg).toFixed(2), mcap(row.price).toFixed(2), (Number(row.ownerTokens) / DEC).toFixed(0), sol(row.crowdNet).toFixed(6)].join(","));
  writeFileSync(`${base}-timeline.csv`, csv.join("\n") + "\n");
  writeFileSync(`${base}-summary.json`, JSON.stringify({ event: ev.id, solUsd, source, summary }, null, 2) + "\n");
  console.log(L.join("\n"));
  console.log(`\nwrote ${base}.md, ${base}-timeline.csv, ${base}-summary.json`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
