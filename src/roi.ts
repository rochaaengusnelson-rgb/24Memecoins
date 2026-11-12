/**
 * ROI scenarios for an event coin whose value is pegged to seats occupied.
 *
 * Rule: the coin launches at startsAt with 0 seats counted. Market cap = launch market cap
 * (fresh pump.fun curve + the owner's seed buy) + rules.pegUsdPerSeat x seats occupied.
 * So the attendance value starts at $0 and moves $1 (default) per person entering or leaving.
 *
 * Each minute the crowd buys or sells on the real pump.fun curve math (live mainnet Global +
 * fee rates, checked against the SDK) exactly enough to hold that peg. Owner exits are market
 * sells into the curve; the crowd re-pegs right after, and the report shows what that costs.
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
import { renderChart } from "./report/chart.js";

const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const RENT_SOL = 0.0092; // mint + curve + ATA rent, from the mainnet dry run (2.711916 out - 2.7027 seed)
const DEC = 1e6;
const CHART_MINUTES = 300; // per-minute rows kept for the chart (launch -> 2:00 AM for a 9 PM start)

interface Sell {
  minute: number;
  fraction: number; // of the owner's tokens held at that moment
  label: string;
}
interface Scenario {
  id: string;
  name: string;
  short: string;
  sells: Sell[];
  burn: boolean;
}
export interface SellOut extends Sell {
  tokens: bigint;
  solNet: bigint;
  mcapPeg: number;
  mcapAfter: number;
  crowdRepeg: bigint;
}
export interface Row {
  minute: number;
  seats: number;
  mcapPeg: number;
  mcap: number;
  ownerTokens: bigint;
  crowdNet: bigint;
}
interface Result {
  sc: Scenario;
  seedGross: bigint;
  ownerTokens0: bigint;
  sells: SellOut[];
  burned: bigint;
  residualTokens: bigint;
  residualValue: bigint;
  creatorFees: bigint;
  crowdIn: bigint;
  crowdOut: bigint;
  crowdResidualValue: bigint;
  rows: Row[];
}

const sol = (l: bigint | number) => Number(l) / 1e9;
const usd = (n: number, dp = 2) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const tok = (t: bigint) => (Number(t) / DEC).toLocaleString("en-US", { maximumFractionDigits: 0 });

export function etClock(startIso: string, minute: number) {
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

function feesFor(g: Global, fc: FeeConfig | null) {
  const f = computeFeesBps({ global: g, feeConfig: fc, mintSupply: g.tokenTotalSupply, virtualQuoteReserves: g.initialVirtualSolReserves, virtualTokenReserves: g.initialVirtualTokenReserves });
  return { protocol: BigInt(f.protocolFeeBps.toString()), creator: BigInt(f.creatorFeeBps.toString()) };
}
function freshCurve(g: Global, fc: FeeConfig | null) {
  return new Curve(
    { vS: BigInt(g.initialVirtualSolReserves.toString()), vT: BigInt(g.initialVirtualTokenReserves.toString()), realT: BigInt(g.initialRealTokenReserves.toString()) },
    feesFor(g, fc),
  );
}

function run(ev: EventConfig, g: Global, fc: FeeConfig | null, solUsd: number, sc: Scenario, windowMin: number): Result {
  const points = ev.attendanceProfile!.points as Array<[number, number]>;
  const capacity = totalCapacity(ev);
  const supply = Number(g.tokenTotalSupply.toString());
  const mcapOf = (price: number) => (price * supply * solUsd) / 1e9;
  const priceOf = (mcap: number) => (mcap * 1e9) / (supply * solUsd);
  const curve = freshCurve(g, fc);

  // 9:00 PM: create + owner seed (quote for the $ seed; headroom only caps max spend).
  const seedGross = usdToLamports(ev.funding.usd, solUsd, 0);
  let ownerTokens = curve.buyGross(seedGross).tokens;
  const ownerTokens0 = ownerTokens;
  curve.creatorFees = 0n; // the creator fee on the owner's own buy is paid by the owner; count only others'
  const launchMcap = mcapOf(curve.price());
  const pegMcap = (seats: number) => launchMcap + ev.rules.pegUsdPerSeat * seats;
  const peakSeats = Math.max(...points.map((p) => p[1]));

  let crowdTokens = 0n;
  let crowdIn = 0n;
  let crowdOut = 0n;
  const sellsOut: SellOut[] = [];
  const rows: Row[] = [{ minute: 0, seats: 0, mcapPeg: launchMcap, mcap: launchMcap, ownerTokens, crowdNet: 0n }];

  const repeg = (mcapTarget: number) => {
    const target = curve.vSForPrice(priceOf(mcapTarget));
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
    const peg = pegMcap(seats);
    repeg(peg);
    for (const s of sc.sells.filter((x) => x.minute === m)) {
      const amt = s.fraction >= 1 ? ownerTokens : (ownerTokens * BigInt(Math.round(s.fraction * 10_000))) / 10_000n;
      if (amt <= 0n) continue;
      const t = curve.sell(amt);
      ownerTokens -= amt;
      const mcapAfter = mcapOf(curve.price());
      // The crowd buys the dump back to the peg; the peg ends when the window closes.
      const absorbed = m < windowMin ? repeg(peg) : 0n;
      sellsOut.push({ ...s, tokens: amt, solNet: t.solNet, mcapPeg: peg, mcapAfter, crowdRepeg: absorbed });
    }
    if (m <= CHART_MINUTES || m % 15 === 0 || m === windowMin)
      rows.push({ minute: m, seats: Math.round(seats), mcapPeg: peg, mcap: mcapOf(curve.price()), ownerTokens, crowdNet: crowdOut - crowdIn });
  }

  let burned = 0n;
  if (sc.burn && ownerTokens > 0n) {
    burned = burnAmount(ownerTokens, Math.min(1, peakSeats / capacity), ev.rules.burnShareAtFullHouse);
    ownerTokens -= burned;
  }
  return {
    sc,
    seedGross,
    ownerTokens0,
    sells: sellsOut,
    burned,
    residualTokens: ownerTokens,
    residualValue: ownerTokens > 0n ? curve.quoteSell(ownerTokens) : 0n,
    creatorFees: curve.creatorFees,
    crowdIn,
    crowdOut,
    crowdResidualValue: crowdTokens > 0n ? curve.quoteSell(crowdTokens) : 0n,
    rows,
  };
}

async function main() {
  const path = args.find((a) => a.endsWith(".json")) ?? "events/msg-nyc-one-night.json";
  const ev = loadEvent(path);
  if (!ev.attendanceProfile) throw new Error(`${path} has no attendanceProfile`);
  if (ev.attendanceProfile.points[0][1] !== 0) throw new Error("attendanceProfile must start at 0 seats at launch");
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
  const perSeat = ev.rules.pegUsdPerSeat;
  const supply = Number(g.tokenTotalSupply.toString());

  // --- cross-check the curve model against the SDK ---
  const check = freshCurve(g, fc);
  const preSeedMcap = (check.price() * supply * solUsd) / 1e9;
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
    { id: "A", short: "Sell 100% mid-show", name: `Owner sells 100% mid-show (${etClock(start, mid)})`, sells: [{ minute: mid, fraction: 1, label: "mid-show" }], burn: true },
    { id: "B", short: "Sell 100% before crowd leaves", name: `Owner sells 100% right before the crowd leaves (${etClock(start, beforeLeave)})`, sells: [{ minute: beforeLeave, fraction: 1, label: "before crowd leaves" }], burn: true },
    { id: "C", short: "Sell 50% / 50%", name: "Owner sells 50% mid-show, 50% before the crowd leaves", sells: [{ minute: mid, fraction: 0.5, label: "mid-show" }, { minute: beforeLeave, fraction: 1, label: "before crowd leaves" }], burn: true },
    { id: "D", short: "Hold + burn", name: "Owner holds; settlement burn at peak fill (baseline rules)", sells: [], burn: true },
    { id: "E", short: "Hold, no burn", name: "Owner holds, no burn; sells at window close (reference)", sells: [{ minute: windowMin, fraction: 1, label: "window close" }], burn: false },
  ];
  const results = scenarios.map((sc) => run(ev, g, fc, solUsd, sc, windowMin));
  const r0 = results[0];
  const launchMcap = r0.rows[0].mcap;
  const peakMcap = launchMcap + perSeat * peakSeats;

  // ---- report ----
  const L: string[] = [];
  const w = (s = "") => L.push(s);
  w(`# ROI report: ${ev.title}`);
  w();
  w(`${ev.artist} · launch ${etClock(start, 0)} ET · headliner ends ${etClock(start, showMin)} ET · ${capacity.toLocaleString()} seats · $${ev.funding.usd} owner seed · ${ev.rules.windowHours}h coin window`);
  w();
  w(`Generated ${new Date().toISOString()} · SOL/USD **$${solUsd}** (held constant) · pump.fun parameters: ${source}`);
  w();
  w(`## Launch rule: $0 at 0 attendance, +$${perSeat} per seat`);
  w();
  w(`- The coin launches at **${etClock(start, 0)} ET exactly, with 0 seats counted**. Its **attendance value** (market cap above launch) is **$0**.`);
  w(`- Each person in the building adds **$${perSeat} of market cap**; each person who leaves takes it back. At the ${peakSeats.toLocaleString()}-seat peak, the attendance value is **${usd(perSeat * peakSeats, 0)}**.`);
  w(`- pump.fun can't list a coin at a literal $0. A fresh curve opens at a **${usd(preSeedMcap, 0)}** market cap, and the owner's $${ev.funding.usd} buy at launch takes it to **${usd(launchMcap, 0)}**. That is the zero line; everything above it is attendance.`);
  w(`- Every minute, the crowd buys or sells on the real curve exactly enough to hold that line. This is the model's assumption; on pump.fun, price is set by whoever trades. Holding the peg live needs a market maker or program trading against the Switchboard attendance feed.`);
  w(`- Fees: ${check.fees.protocol} bps protocol + ${check.fees.creator} bps creator on every trade (live). The owner is the coin creator and earns the creator fee on all crowd volume.`);
  w(`- Curve model checked against the pump.fun SDK: first buy ${tok(modelBuy)} vs SDK ${tok(sdkBuy)} tokens (${(relErr(modelBuy, sdkBuy) * 100).toFixed(4)}% diff); selling that bag ${sol(modelSell).toFixed(6)} vs SDK ${sol(sdkSell).toFixed(6)} SOL (${(relErr(modelSell, sdkSell) * 100).toFixed(4)}% diff).`);
  w();
  w(`## Attendance → value`);
  w();
  w(`| Time (ET) | Seats occupied | Fill | Attendance value | Market cap | vs launch |`);
  w(`|---|---:|---:|---:|---:|---:|`);
  const marks: Array<[number, string]> = [[0, "launch"], [15, ""], [30, ""], [60, ""], [90, ""], [mid, "mid-show"], [beforeLeave, "before crowd leaves"], [showMin, "headliner ends"], [showMin + 10, ""], [showMin + 20, ""], [showMin + 30, ""], [showMin + 60, ""]];
  for (const [m, tag] of marks) {
    const s = seatsAt(points, m);
    const mc = launchMcap + perSeat * s;
    w(`| ${etClock(start, m)}${tag ? ` (${tag})` : ""} | ${Math.round(s).toLocaleString()} | ${((s / capacity) * 100).toFixed(1)}% | ${usd(perSeat * s, 0)} | ${usd(mc, 0)} | ${pct(mc / launchMcap - 1)} |`);
  }
  w();
  w(`## Owner ROI by scenario`);
  w();
  w(`Owner cost: ${sol(r0.seedGross).toFixed(4)} SOL seed (${usd(ev.funding.usd)}) + ${RENT_SOL} SOL account rent = **${usd((sol(r0.seedGross) + RENT_SOL) * solUsd)}**. Bought at the zero line: ${tok(r0.ownerTokens0)} tokens (${((Number(r0.ownerTokens0) / supply) * 100).toFixed(2)}% of supply).`);
  w();
  w(`| | Scenario | Sale proceeds | Creator fees | Bag left (value) | Owner total | **Owner ROI** | Crowd net |`);
  w(`|---|---|---:|---:|---:|---:|---:|---:|`);
  const summary: Array<{ id: string; short: string; scenario: string; costSol: number; proceedsSol: number; creatorFeesSol: number; residualSol: number; totalSol: number; roi: number; crowdNetSol: number; burnedTokens: string }> = [];
  for (const r of results) {
    const cost = sol(r.seedGross) + RENT_SOL;
    const proceeds = r.sells.reduce((a, s) => a + sol(s.solNet), 0);
    const fees = sol(r.creatorFees);
    const resid = sol(r.residualValue);
    const total = proceeds + fees + resid;
    const roi = total / cost - 1;
    const crowd = sol(r.crowdOut - r.crowdIn + r.crowdResidualValue);
    summary.push({ id: r.sc.id, short: r.sc.short, scenario: r.sc.name, costSol: cost, proceedsSol: proceeds, creatorFeesSol: fees, residualSol: resid, totalSol: total, roi, crowdNetSol: crowd, burnedTokens: tok(r.burned) });
    w(`| ${r.sc.id} | ${r.sc.name} | ${usd(proceeds * solUsd)} | ${usd(fees * solUsd)} | ${r.residualTokens > 0n ? `${tok(r.residualTokens)} (${usd(resid * solUsd)})` : "—"} | ${usd(total * solUsd)} | **${pct(roi)}** (${usd((total - cost) * solUsd)}) | ${usd(crowd * solUsd)} |`);
  }
  w();
  w(`"Crowd net" is what everyone else, all buyers together, ends with: SOL out − SOL in + the value of tokens still held.`);
  w();
  w(`## What each owner sale does to the price`);
  w();
  w(`| | Sale | Time (ET) | Tokens sold | Proceeds | Market cap: peg → right after | Crowd SOL to restore the peg |`);
  w(`|---|---|---|---:|---:|---:|---:|`);
  for (const r of results)
    for (const s of r.sells)
      w(`| ${r.sc.id} | ${s.label} | ${etClock(start, s.minute)} | ${tok(s.tokens)} | ${usd(sol(s.solNet) * solUsd)} | ${usd(s.mcapPeg, 0)} → ${usd(s.mcapAfter, 0)} (${pct(s.mcapAfter / s.mcapPeg - 1)}) | ${s.crowdRepeg > 0n ? usd(sol(s.crowdRepeg) * solUsd) : "— (window closed, peg ended)"} |`);
  w();
  w(`## Settlement`);
  w();
  for (const r of results)
    if (r.sc.burn)
      w(`- **${r.sc.id}:** ${r.burned > 0n ? `burns ${tok(r.burned)} tokens (${((peakSeats / capacity) * 100).toFixed(1)}% peak fill × ${ev.rules.burnShareAtFullHouse}); owner keeps ${tok(r.residualTokens)}.` : "nothing to burn: the owner already sold the whole bag, so holders don't get the attendance burn."}`);
  w();
  w(`## Takeaways`);
  w();
  const [A, B, C, D, E] = summary;
  const aSale = results[0].sells[0];
  const cSale = results[2].sells[0];
  w(`1. **Launching at zero attendance gives the owner the cheapest entry.** The owner buys at the zero line, before anyone is counted, so the full ${usd(perSeat * peakSeats, 0)} of attendance value builds on top of the owner's bag. Market cap peaks at ${pct(peakMcap / launchMcap - 1)} over launch.`);
  w(`2. **Mid-show (A) and just before the crowd leaves (B) pay the same: ${pct(A.roi)} / ${pct(B.roi)}.** The building is full (${peakSeats.toLocaleString()}) from ${etClock(start, 90)} to ${etClock(start, beforeLeave)}, so both sales hit the same peg. Ten minutes after the headliner ends, the attendance value is down ${pct(1 - seatsAt(points, showMin + 10) / peakSeats).replace("+", "")}.`);
  w(`3. **Splitting the exit (C) earns more: ${pct(C.roi)}.** Each half knocks the market cap ${pct(cSale.mcapAfter / cSale.mcapPeg - 1)} instead of ${pct(aSale.mcapAfter / aSale.mcapPeg - 1)}. Buyers restore the peg between the two sales, at the crowd's expense (crowd net ${usd(C.crowdNetSol * solUsd)} vs ${usd(A.crowdNetSol * solUsd)}).`);
  w(`4. **Holding under the burn rule (D): ${pct(D.roi)}.** The burn destroys the bag the attendance built. Holding without a burn (E): ${pct(E.roi)}. Once the venue empties, value returns to the zero line.`);
  w(`5. **Every owner sale is paid for by the crowd.** In A, buyers spend ${usd(sol(aSale.crowdRepeg) * solUsd)} to undo a ${pct(aSale.mcapAfter / aSale.mcapPeg - 1)} drop, and settlement has nothing left to burn. If owners can sell mid-event, disclose it up front, or lock the owner bag until settlement.`);
  w();
  w(`## Assumptions`);
  w();
  w(`- Attendance is the modeled occupancy profile in \`${path}\` (0 at launch, peak ${peakSeats.toLocaleString()}); it must come from a real Switchboard feed (door scans in and out) before launch.`);
  w(`- SOL/USD stays at $${solUsd} throughout. No other traders, bots or snipers: crowd trades are exactly what holds the peg.`);
  w(`- The settlement burn uses peak occupancy (${peakSeats.toLocaleString()}), because occupancy is 0 by the time the window closes.`);
  w(`- Creator fees are counted on crowd trades only, and claimable by the owner whether or not they sold.`);
  w(`- Not financial advice. This models one rule set; real markets won't hold a peg on their own.`);

  mkdirSync("reports", { recursive: true });
  const base = `reports/${ev.id}-roi`;
  writeFileSync(`${base}.md`, L.join("\n") + "\n");
  const csv = ["scenario,time_et,minute,seats,attendance_value_usd,peg_mcap_usd,mcap_usd,owner_tokens,crowd_net_sol"];
  for (const r of results)
    for (const row of r.rows.filter((x) => x.minute % 5 === 0 || x.minute === 1))
      csv.push([r.sc.id, `"${etClock(start, row.minute)}"`, row.minute, row.seats, (row.mcapPeg - launchMcap).toFixed(2), row.mcapPeg.toFixed(2), row.mcap.toFixed(2), (Number(row.ownerTokens) / DEC).toFixed(0), sol(row.crowdNet).toFixed(6)].join(","));
  writeFileSync(`${base}-timeline.csv`, csv.join("\n") + "\n");
  writeFileSync(`${base}-summary.json`, JSON.stringify({ event: ev.id, solUsd, source, launchMcap, perSeat, summary }, null, 2) + "\n");
  writeFileSync(
    `${base}-chart.html`,
    renderChart({
      title: ev.title,
      subtitle: `${ev.artist} · launch ${etClock(start, 0)} ET at 0 seats · +$${perSeat} market cap per seat · SOL $${solUsd}`,
      startIso: start,
      capacity,
      launchMcap,
      perSeat,
      showEndMinute: showMin,
      chartMinutes: CHART_MINUTES,
      rows: r0.rows.filter((x) => x.minute <= CHART_MINUTES).map((x) => ({ m: x.minute, seats: x.seats, peg: x.mcapPeg })),
      sales: results.flatMap((r) => r.sells.filter((s) => s.minute <= CHART_MINUTES).map((s, i, all) => ({ id: r.sc.id, tag: all.length > 1 ? `${r.sc.id}${i + 1}` : r.sc.id, label: `${r.sc.id}: sells ${s.fraction >= 1 && r.sc.sells.length > 1 ? "rest" : `${Math.round(s.fraction * 100)}%`}`, m: s.minute, peg: s.mcapPeg, after: s.mcapAfter, proceedsUsd: sol(s.solNet) * solUsd }))),
      roi: summary.map((s) => ({ id: s.id, name: s.short, roi: s.roi, totalUsd: s.totalSol * solUsd, crowdUsd: s.crowdNetSol * solUsd })),
    }),
  );
  console.log(L.join("\n"));
  console.log(`\nwrote ${base}.md, ${base}-timeline.csv, ${base}-summary.json, ${base}-chart.html`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
