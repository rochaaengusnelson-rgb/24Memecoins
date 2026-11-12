/**
 * Monte Carlo market scenarios: micro traders + whales (+ optional attendance market maker)
 * trading the event coin on the pump.fun curve, around the event's attendance profile.
 *
 *   npm run market -- events/msg-nyc-one-night.json --runs 200 --sol-usd 185 --seed 1
 *   npm run market -- events/msg-nyc-one-night.json --seeds-usd 500,1000,3000,5000   (owner seed sweep)
 *   npm run market -- events/msg-nyc-one-night.json --seed-usd 3000                  (one seed amount)
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchTime, loadEvent, totalCapacity } from "./event.js";
import { usdToLamports } from "./math.js";
import { DEFAULT_MICRO, DEFAULT_WHALES, simulate, type MarketParams, type RunResult } from "./model/market.js";
import { freshCurve, livePumpParams } from "./model/pump.js";
import { etClock } from "./time.js";
import { renderMarketChart } from "./report/marketChart.js";
import { writeSeedSweep } from "./seedSweep.js";
import { RENT_SOL, band, pct, q, usd } from "./stats.js";

const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
interface Scenario {
  id: string;
  name: string;
  short: string;
  build: (base: MarketParams) => MarketParams;
}

async function main() {
  const path = args.find((a) => a.endsWith(".json")) ?? "events/msg-nyc-one-night.json";
  const runs = Number(opt("--runs") ?? 200);
  const seed0 = Number(opt("--seed") ?? 1);
  const solUsd = Number(opt("--sol-usd") ?? 185);
  const ev = loadEvent(path);
  if (!ev.attendanceProfile) throw new Error(`${path} has no attendanceProfile`);
  const { global: g, feeConfig: fc, source } = await livePumpParams();

  const launch = launchTime(ev);
  const mins = (iso: string) => Math.round((Date.parse(iso) - Date.parse(launch)) / 60_000);
  const showStart = mins(ev.startsAt);
  const showEnd = ev.endsAt ? mins(ev.endsAt) : showStart + 210;
  const mid = Math.round((showStart + showEnd) / 2);
  const beforeLeave = showEnd - 5;
  const chartMinutes = Math.ceil((showEnd + 90) / 60) * 60;
  const points = ev.attendanceProfile.points as Array<[number, number]>;
  const capacity = totalCapacity(ev);
  /** Runs every scenario for one owner seed amount (same random seeds for every amount). */
  const computeMetrics = (seedUsd: number) => {
    const seedLamports = usdToLamports(seedUsd, solUsd, 0);

    const base: MarketParams = {
      solUsd,
      supply: Number(g.tokenTotalSupply.toString()),
      capacity,
      points,
      showStart,
      showEnd,
      windowMin: Math.round(ev.rules.windowHours * 60),
      perSeatUsd: ev.rules.pegUsdPerSeat,
      ownerSeedLamports: seedLamports,
      burnShareAtFullHouse: ev.rules.burnShareAtFullHouse,
      micro: DEFAULT_MICRO,
      whales: DEFAULT_WHALES,
      owner: { kind: "hold-burn" },
    };
    const keeper = { inventoryUsd: 1500, bandPct: 0.05, maxUsdPerMin: 400, budgetUsd: 4000 };
    const scenarios: Scenario[] = [
      { id: "S1", short: "Organic market", name: "Organic market: micro traders + 4 whales, owner holds (burn at settlement)", build: (b) => b },
      { id: "S2", short: "Organic + attendance market maker", name: `Same, plus an attendance market maker ($${keeper.budgetUsd.toLocaleString()} budget incl. $${keeper.inventoryUsd.toLocaleString()} inventory bought at launch, ±${keeper.bandPct * 100}% band, ≤$${keeper.maxUsdPerMin}/min)`, build: (b) => ({ ...b, pegKeeper: keeper }) },
      { id: "S3", short: "Owner sells mid-show", name: `Organic market, owner sells 100% mid-show (${etClock(launch, mid)})`, build: (b) => ({ ...b, owner: { kind: "sell", sellMinute: mid } }) },
      { id: "S4", short: "Owner sells before crowd leaves", name: `Organic market, owner sells 100% right before the crowd leaves (${etClock(launch, beforeLeave)})`, build: (b) => ({ ...b, owner: { kind: "sell", sellMinute: beforeLeave } }) },
      { id: "S5", short: "Micro traders only", name: "Micro traders only, no whales, owner holds (baseline)", build: (b) => ({ ...b, whales: [] }) },
    ];

    const toUsd = (l: bigint) => (Number(l) / 1e9) * solUsd;
    const results = scenarios.map((sc) => {
      const params = sc.build(base);
      const rs: RunResult[] = [];
      for (let i = 0; i < runs; i++) rs.push(simulate(freshCurve(g, fc), params, seed0 * 1_000_003 + i));
      return { sc, params, rs };
    });

    // ---- metrics ----
    const costUsd = toUsd(seedLamports) + RENT_SOL * solUsd;
    const metrics = results.map(({ sc, rs }) => {
      const ownerRoi = rs.map((r) => (toUsd(r.owner.proceeds + r.owner.creatorFees + r.owner.markValue)) / costUsd - 1);
      const ownerFees = rs.map((r) => toUsd(r.owner.creatorFees));
      const whale = (DEFAULT_WHALES.map((w) => w.id)).map((id) => {
        const pnl = rs.map((r) => r.whales.find((x) => x.id === id)).filter(Boolean).map((x) => toUsd(x!.solOut + x!.markValue - x!.solIn));
        return { id, pnl, winRate: pnl.length ? pnl.filter((x) => x > 0).length / pnl.length : NaN };
      });
      const microPnl = rs.map((r) => toUsd(r.micro.solOut + r.micro.markValue - r.micro.solIn));
      const microWin = rs.map((r) => r.micro.walletsProfitable / Math.max(1, r.micro.walletsTraded));
      const microWallets = rs.map((r) => r.micro.walletsTraded);
      const microTrades = rs.map((r) => r.micro.trades);
      const keeperPnl = rs[0].keeper ? rs.map((r) => toUsd(r.keeper!.solOut + r.keeper!.markValue - r.keeper!.solIn)) : undefined;
      const peak = rs.map((r) => r.peakMcap);
      const close = rs.map((r) => r.closeMcap);
      const track = rs.map((r) => r.trackingErr);
      const grads = rs.filter((r) => r.graduated).length;
      // representative run: the one whose peak market cap is closest to the median
      const medPeak = q(peak, 0.5);
      const rep = rs.reduce((a, r) => (Math.abs(r.peakMcap - medPeak) < Math.abs(a.peakMcap - medPeak) ? r : a), rs[0]);
      // per-time percentiles of market cap
      const steps = rs[0].path.length;
      const fan = Array.from({ length: steps }, (_, i) => {
        const xs = rs.map((r) => r.path[i].mcap);
        const p0 = rs[0].path[i];
        return { m: p0.m, seats: p0.seats, peg: p0.peg, p10: q(xs, 0.1), p50: q(xs, 0.5), p90: q(xs, 0.9) };
      });
      return { sc, ownerRoi, ownerFees, whale, microPnl, microWin, microWallets, microTrades, keeperPnl, peak, close, track, grads, rep, fan };
    });
    return { seedUsd, seedLamports, costUsd, results, metrics };
  };

  const sweep = opt("--seeds-usd");
  if (sweep) {
    const amounts = sweep.split(",").map(Number).filter((x) => x > 0);
    writeSeedSweep({ ev, path, runs, seed0, solUsd, source, launch, showStart, showEnd, chartMinutes, capacity, points, supply: Number(g.tokenTotalSupply.toString()), realTokens: Number(g.initialRealTokenReserves.toString()), sweeps: amounts.map((amt) => computeMetrics(amt)) });
    return;
  }
  const seedUsd = Number(opt("--seed-usd") ?? ev.funding.usd);
  ev.funding.usd = seedUsd;
  const { results, metrics } = computeMetrics(seedUsd);

  const launchMcap = results[0].rs[0].launchMcap;
  const peakSeats = Math.max(...points.map((p) => p[1]));

  // ---- report ----
  const L: string[] = [];
  const w = (s = "") => L.push(s);
  w(`# Market scenarios: ${ev.title}`);
  w();
  w(`${ev.artist} · coin live ${etClock(launch, 0)} ET · show ${etClock(launch, showStart)} – ${etClock(launch, showEnd)} ET · ${capacity.toLocaleString()} seats · $${ev.funding.usd} owner seed · ${ev.rules.windowHours}h window`);
  w();
  w(`${runs} seeded runs per scenario (seed ${seed0}) · SOL/USD $${solUsd} (constant) · pump.fun curve math with ${source} parameters`);
  w();
  w(`Each cell shows the **median**, with the 10th–90th percentile range across runs in brackets. The **attendance value** line is the launch market cap (${usd(launchMcap)}) + $${ev.rules.pegUsdPerSeat} per seat occupied. Traders watch it, but nothing forces the price onto it unless a market maker is running (S2).`);
  w();
  w(`## Who trades`);
  w();
  const m0 = DEFAULT_MICRO;
  w(`- **Micro traders:** ${m0.wallets.toLocaleString()} wallets (fans in the building and online). Trades arrive at ${m0.baseRatePerMin}/min on an empty night, up to ${(m0.baseRatePerMin + m0.peakRatePerMin).toFixed(1)}/min at a full house, plus a burst when the crowd leaves. Buys are lognormal, median $${m0.medianUsd} ($${m0.minUsd}–$${m0.maxUsd}). They lean toward buying while people are arriving or the price is below the attendance value, and toward selling when people leave or the price runs above it. A seller up more than ${m0.takeProfit * 100}% sells everything; otherwise half.`);
  for (const wh of DEFAULT_WHALES) w(`- **${wh.id}, ${wh.name}:** budget ~${usd(wh.budgetUsd)} (±25% per run, timing ±10–20 min).`);
  w(`- **Owner:** $${ev.funding.usd} first buy at ${etClock(launch, 0)}; holds into the settlement burn unless the scenario says otherwise.`);
  w();
  w(`## Results`);
  w();
  w(`| | Scenario | Peak market cap | Market cap at window close | Off attendance value (avg) | Owner creator fees | Owner ROI (incl. fees) |`);
  w(`|---|---|---:|---:|---:|---:|---:|`);
  for (const x of metrics) w(`| ${x.sc.id} | ${x.sc.name} | ${band(x.peak, usd)} | ${band(x.close, usd)} | ${band(x.track, (n) => `${(n * 100).toFixed(1)}%`)} | ${band(x.ownerFees, usd)} | ${band(x.ownerRoi, pct)} |`);
  w();
  w(`### Whales (P&L in USD; win rate = share of runs in profit)`);
  w();
  w(`| | ${DEFAULT_WHALES.map((x) => x.id).join(" | ")} |`);
  w(`|---|${DEFAULT_WHALES.map(() => "---:").join("|")}|`);
  for (const x of metrics) {
    if (!x.whale.some((y) => y.pnl.length)) continue;
    w(`| ${x.sc.id} | ${x.whale.map((y) => (y.pnl.length ? `${band(y.pnl, usd)} · ${(y.winRate * 100).toFixed(0)}% win` : "—")).join(" | ")} |`);
  }
  w();
  w(`### Micro traders and market maker`);
  w();
  w(`| | Micro P&L (all wallets) | Micro wallets in profit | Wallets that traded | Micro trades | Market maker P&L |`);
  w(`|---|---:|---:|---:|---:|---:|`);
  for (const x of metrics)
    w(`| ${x.sc.id} | ${band(x.microPnl, usd)} | ${band(x.microWin, (n) => `${(n * 100).toFixed(0)}%`)} | ${Math.round(q(x.microWallets, 0.5)).toLocaleString()} | ${Math.round(q(x.microTrades, 0.5)).toLocaleString()} | ${x.keeperPnl ? band(x.keeperPnl, usd) : "—"} |`);
  w();
  const grads = metrics.filter((x) => x.grads > 0);
  if (grads.length) w(`Curve filled (graduated to PumpSwap) in: ${grads.map((x) => `${x.sc.id} ${x.grads}/${runs}`).join(", ")}. Trading after graduation isn't modeled.`);
  w();

  // ---- takeaways (computed) ----
  const [S1, S2, S3, S4, S5] = metrics;
  const med = (xs: number[]) => q(xs, 0.5);
  const whaleById = (x: (typeof metrics)[number], id: string) => x.whale.find((y) => y.id === id)!;
  const bestWhale = DEFAULT_WHALES.map((wh) => ({ wh, v: med(whaleById(S1, wh.id).pnl), win: whaleById(S1, wh.id).winRate })).sort((a, b) => b.v - a.v);
  w(`## Takeaways`);
  w();
  w(`1. **Without a market maker, price follows the crowd only loosely.** In the organic market (S1) the price averages ${(med(S1.track) * 100).toFixed(0)}% off the attendance value. Peak market cap is a median ${usd(med(S1.peak))} against an attendance peak of ${usd(launchMcap + ev.rules.pegUsdPerSeat * peakSeats)}.`);
  const tighter = med(S2.track) < med(S1.track) * 0.8;
  w(`2. **${tighter ? "A market maker pulls the price toward attendance" : "A small market maker barely moves the price"}:** S2 averages ${(med(S2.track) * 100).toFixed(0)}% off the attendance value, against ${(med(S1.track) * 100).toFixed(0)}% without one. It sells its inventory into the hype rally and buys back when people leave. Median P&L ${usd(med(S2.keeperPnl ?? [0]))}, holding whatever it couldn't sell once the venue empties.`);
  w(`3. **Timing beats size among whales.** The best is ${bestWhale[0].wh.id} (${bestWhale[0].wh.strategy}: median ${usd(bestWhale[0].v)}, ${(bestWhale[0].win * 100).toFixed(0)}% of runs in profit). The worst is ${bestWhale[bestWhale.length - 1].wh.id} (${bestWhale[bestWhale.length - 1].wh.strategy}: median ${usd(bestWhale[bestWhale.length - 1].v)}, ${(bestWhale[bestWhale.length - 1].win * 100).toFixed(0)}% win). Whoever buys before the crowd arrives and sells before it leaves takes the move; late buyers fund it.`);
  w(`4. **Micro traders lose in aggregate** (S1 median ${usd(med(S1.microPnl))}, ${(med(S1.microWin) * 100).toFixed(0)}% of wallets in profit). Without whales (S5) they lose ${usd(med(S5.microPnl))}. Fees on ~${Math.round(med(S1.microTrades)).toLocaleString()} trades plus buying high during the show are the cost.`);
  w(`5. **Owner exits:** selling mid-show (S3) returns a median ${pct(med(S3.ownerRoi))}, and just before the crowd leaves (S4) ${pct(med(S4.ownerRoi))}. Holding into the burn (S1) returns ${pct(med(S1.ownerRoi))}: the burn wipes out the bag, and creator fees on the crowd's trading (median ${usd(med(S1.ownerFees))}) recover part of the seed. Every owner sale lands on the same micro traders. If owners may sell, disclose it before launch, or lock the owner bag.`);
  w();
  w(`## Assumptions`);
  w();
  w(`- Trader behavior is a model with made-up but plausible parameters (see \`src/model/market.ts\`), not data. Change them and the numbers move; compare scenarios against each other rather than taking absolute values as forecasts.`);
  w(`- Tokens still held at window close are valued together at what selling all of them into the curve would return, split pro rata, so no paper gains are counted. Burned tokens are gone, which raises everyone else's share.`);
  w(`- No snipers or MEV in the same block as the launch, no outside news, and SOL/USD is constant.`);
  w(`- Attendance is the modeled profile in \`${path}\`.`);
  w(`- Not financial advice.`);

  mkdirSync("reports", { recursive: true });
  const baseName = `reports/${ev.id}-market`;
  writeFileSync(`${baseName}.md`, L.join("\n") + "\n");
  const summary = metrics.map((x) => ({
    id: x.sc.id,
    scenario: x.sc.name,
    peakMcap: { p10: q(x.peak, 0.1), p50: q(x.peak, 0.5), p90: q(x.peak, 0.9) },
    closeMcap: { p10: q(x.close, 0.1), p50: q(x.close, 0.5), p90: q(x.close, 0.9) },
    trackingErr: q(x.track, 0.5),
    ownerRoi: { p10: q(x.ownerRoi, 0.1), p50: q(x.ownerRoi, 0.5), p90: q(x.ownerRoi, 0.9) },
    whales: x.whale.filter((y) => y.pnl.length).map((y) => ({ id: y.id, p50: q(y.pnl, 0.5), winRate: y.winRate })),
    microPnl: q(x.microPnl, 0.5),
    microWinRate: q(x.microWin, 0.5),
    keeperPnl: x.keeperPnl ? q(x.keeperPnl, 0.5) : null,
  }));
  writeFileSync(`${baseName}-summary.json`, JSON.stringify({ event: ev.id, runs, seed: seed0, solUsd, source, summary }, null, 2) + "\n");
  writeFileSync(
    `${baseName}-chart.html`,
    renderMarketChart({
      title: `${ev.title}: market scenarios`,
      subtitle: `${runs} runs per scenario · micro traders + whales on the pump.fun curve · coin live ${etClock(launch, 0)} ET · show ${etClock(launch, showStart)} – ${etClock(launch, showEnd)} · SOL $${solUsd}`,
      labels: Array.from({ length: chartMinutes + 1 }, (_, m) => etClock(launch, m)),
      ticks: Array.from({ length: chartMinutes / 60 + 1 }, (_, i) => ({ m: i * 60, t: etClock(launch, i * 60).replace(/^\S+ /, "").replace(":00", "") })),
      chartMinutes,
      showStart,
      showEnd,
      capacity,
      launchMcap,
      seats: metrics[0].fan.filter((f) => f.m <= chartMinutes).map((f) => ({ m: f.m, seats: f.seats })),
      panels: metrics.map((x) => ({
        id: x.sc.id,
        name: x.sc.name,
        fan: x.fan.filter((f) => f.m <= chartMinutes),
        marks: x.rep.marks.filter((k) => k.minute <= chartMinutes),
        stats: `median peak ${usd(med(x.peak))} · owner ROI ${pct(med(x.ownerRoi))} · micro P&L ${usd(med(x.microPnl))}${x.keeperPnl ? ` · market maker ${usd(med(x.keeperPnl))}` : ""}`,
      })),
    }),
  );
  console.log(L.join("\n"));
  console.log(`\nwrote ${baseName}.md, ${baseName}-summary.json, ${baseName}-chart.html`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
