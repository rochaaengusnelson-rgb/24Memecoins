/** Owner seed sweep: the same market scenarios (same random seeds) at several owner seed amounts. */
import { mkdirSync, writeFileSync } from "node:fs";
import type { EventConfig } from "./event.js";
import type { RunResult } from "./model/market.js";
import { BASE_CSS, esc } from "./report/chart.js";
import { RENT_SOL, band, pct, q, usd } from "./stats.js";
import { etClock } from "./time.js";

interface ScenarioMetrics {
  sc: { id: string; short: string; name: string };
  ownerRoi: number[];
  ownerFees: number[];
  whale: Array<{ id: string; pnl: number[]; winRate: number }>;
  microPnl: number[];
  microWin: number[];
  keeperPnl?: number[];
  peak: number[];
  close: number[];
  track: number[];
  grads: number;
  fan: Array<{ m: number; seats: number; peg: number; p10: number; p50: number; p90: number }>;
}
interface SweepEntry {
  seedUsd: number;
  seedLamports: bigint;
  costUsd: number;
  results: Array<{ rs: RunResult[] }>;
  metrics: ScenarioMetrics[];
}
export interface SweepInput {
  ev: EventConfig;
  path: string;
  runs: number;
  seed0: number;
  solUsd: number;
  source: string;
  launch: string;
  showStart: number;
  showEnd: number;
  chartMinutes: number;
  capacity: number;
  points: Array<[number, number]>;
  supply: number;
  realTokens: number;
  sweeps: SweepEntry[];
}

const med = (xs: number[]) => q(xs, 0.5);
const k$ = (n: number) => (n >= 1000 ? `$${n / 1000}k` : `$${n}`);

export function writeSeedSweep(d: SweepInput) {
  const { ev, sweeps, solUsd } = d;
  const peakSeats = Math.max(...d.points.map((p) => p[1]));
  const perSeat = ev.rules.pegUsdPerSeat;
  const ids = sweeps[0].metrics.map((m) => m.sc.id);
  const byId = (s: SweepEntry, id: string) => s.metrics.find((m) => m.sc.id === id)!;
  const facts = sweeps.map((s) => {
    const r0 = s.results[0].rs[0];
    const tokens = Number(r0.owner.tokens0);
    const launchMcap = r0.launchMcap;
    return {
      s,
      sol: Number(s.seedLamports) / 1e9,
      tokens,
      share: tokens / d.supply,
      curveProgress: tokens / d.realTokens,
      launchMcap,
      attendancePeak: launchMcap + perSeat * peakSeats,
      upside: (perSeat * peakSeats) / launchMcap,
      grads: s.metrics.reduce((a, m) => a + m.grads, 0),
    };
  });

  const L: string[] = [];
  const w = (s = "") => L.push(s);
  w(`# Owner seed sweep: ${sweeps.map((s) => k$(s.seedUsd)).join(" / ")}: ${ev.title}`);
  w();
  w(`${ev.artist} · coin live ${etClock(d.launch, 0)} ET · show ${etClock(d.launch, d.showStart)} – ${etClock(d.launch, d.showEnd)} ET · ${d.capacity.toLocaleString()} seats · ${ev.rules.windowHours}h window`);
  w();
  w(`${d.runs} runs per scenario per seed amount · random seed ${d.seed0}, **the same draws at every amount**, so only the owner's seed differs · SOL/USD $${solUsd} · pump.fun parameters: ${d.source}`);
  w();
  w(`Same micro traders, whales and scenarios as the market report. Cells show the **median**, with the 10th–90th percentile range in brackets.`);
  w();
  w(`## What the seed buys at 7:00 PM`);
  w();
  w(`| Owner seed | SOL | Owner tokens | Share of supply | Curve sold to owner | Launch market cap | Attendance value at peak | Attendance upside |`);
  w(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const f of facts)
    w(`| **${usd(f.s.seedUsd)}** | ${f.sol.toFixed(2)} | ${(f.tokens / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })} | ${(f.share * 100).toFixed(1)}% | ${(f.curveProgress * 100).toFixed(1)}% | ${usd(f.launchMcap)} | ${usd(f.attendancePeak)} | ${pct(f.upside)} |`);
  w();
  w(`The attendance value adds the same ${usd(perSeat * peakSeats)} at peak whatever the seed. A bigger seed raises the starting market cap, so that ${usd(perSeat * peakSeats)} is a smaller relative move.`);
  w();
  w(`## Owner ROI by scenario`);
  w();
  w(`| Scenario | ${sweeps.map((s) => `Seed ${k$(s.seedUsd)}`).join(" | ")} |`);
  w(`|---|${sweeps.map(() => "---:").join("|")}|`);
  for (const id of ids) {
    const name = byId(sweeps[0], id).sc.short;
    w(`| ${id} · ${name} | ${sweeps.map((s) => band(byId(s, id).ownerRoi, pct)).join(" | ")} |`);
  }
  w();
  w(`Owner P&L in dollars (median, including creator fees):`);
  w();
  w(`| Scenario | ${sweeps.map((s) => `Seed ${k$(s.seedUsd)}`).join(" | ")} |`);
  w(`|---|${sweeps.map(() => "---:").join("|")}|`);
  for (const id of ids) {
    const name = byId(sweeps[0], id).sc.short;
    w(`| ${id} · ${name} | ${sweeps.map((s) => usd(med(byId(s, id).ownerRoi) * (s.costUsd))).join(" | ")} |`);
  }
  w(`| Owner creator fees (S1) | ${sweeps.map((s) => usd(med(byId(s, "S1").ownerFees))).join(" | ")} |`);
  w();
  w(`## Market (S1, organic: micro traders + whales, owner holds)`);
  w();
  w(`| Owner seed | Peak market cap | Market cap at window close | Off attendance value (avg) | Runs where the curve filled (all scenarios) |`);
  w(`|---|---:|---:|---:|---:|`);
  for (const f of facts) {
    const m = byId(f.s, "S1");
    w(`| ${usd(f.s.seedUsd)} | ${band(m.peak, usd)} | ${band(m.close, usd)} | ${band(m.track, (n) => `${(n * 100).toFixed(1)}%`)} | ${f.grads} / ${d.runs * f.s.metrics.length} |`);
  }
  w();
  w(`## Whales (S1 P&L, win rate)`);
  w();
  const whaleIds = byId(sweeps[0], "S1").whale.map((x) => x.id);
  w(`| Owner seed | ${whaleIds.join(" | ")} |`);
  w(`|---|${whaleIds.map(() => "---:").join("|")}|`);
  for (const s of sweeps) w(`| ${usd(s.seedUsd)} | ${byId(s, "S1").whale.map((x) => `${usd(med(x.pnl))} · ${(x.winRate * 100).toFixed(0)}%`).join(" | ")} |`);
  w();
  w(`## Micro traders and market maker`);
  w();
  w(`| Owner seed | Micro P&L, S1 hold | Micro wallets in profit, S1 | Micro P&L, S3 owner sells mid-show | Micro P&L, S4 owner sells before exit | Market maker P&L (S2) |`);
  w(`|---|---:|---:|---:|---:|---:|`);
  for (const s of sweeps)
    w(`| ${usd(s.seedUsd)} | ${usd(med(byId(s, "S1").microPnl))} | ${(med(byId(s, "S1").microWin) * 100).toFixed(0)}% | ${usd(med(byId(s, "S3").microPnl))} | ${usd(med(byId(s, "S4").microPnl))} | ${byId(s, "S2").keeperPnl ? usd(med(byId(s, "S2").keeperPnl!)) : "—"} |`);
  w();

  // ---- takeaways (computed) ----
  const first = facts[0];
  const last = facts[facts.length - 1];
  const roiS3 = sweeps.map((s) => med(byId(s, "S3").ownerRoi));
  const usdS3 = sweeps.map((s) => med(byId(s, "S3").ownerRoi) * s.costUsd);
  const usdS1 = sweeps.map((s) => med(byId(s, "S1").ownerRoi) * s.costUsd);
  const microS3 = sweeps.map((s) => med(byId(s, "S3").microPnl));
  const w1 = sweeps.map((s) => med(byId(s, "S1").whale.find((x) => x.id === "W1")!.pnl));
  w(`## Takeaways`);
  w();
  w(`1. **A bigger seed buys the owner a much larger share of the coin.** ${usd(first.s.seedUsd)} buys ${(first.share * 100).toFixed(1)}% of supply; ${usd(last.s.seedUsd)} buys ${(last.share * 100).toFixed(1)}%. pump.fun prices rise as the curve sells, so each extra dollar buys fewer tokens, but the owner still holds a growing stake.`);
  w(`2. **The relative upside from attendance shrinks.** A full house adds the same ${usd(perSeat * peakSeats)} of value, which is ${pct(first.upside)} on a ${usd(first.launchMcap)} launch but only ${pct(last.upside)} on ${usd(last.launchMcap)}.`);
  w(`3. **Selling mid-show (S3): the percentage falls but the dollars rise.** ROI goes ${roiS3.map(pct).join(" → ")} while the dollar gain goes ${usdS3.map(usd).join(" → ")}. A bigger bag dumped into the same crowd extracts more in total.`);
  const microS1 = sweeps.map((s) => med(byId(s, "S1").microPnl));
  w(`4. **Holding into the burn (S1) costs the owner more as the seed grows** (${usdS1.map(usd).join(" → ")}) **and cushions the crowd** (micro-trader P&L ${microS1.map(usd).join(" → ")}). The burned tokens leave their SOL in the curve, backing everyone else's tokens. Creator fees don't scale with the seed.`);
  w(`5. **Who pays when the owner sells mid-show:** micro-trader P&L goes ${microS3.map(usd).join(" → ")} across seed amounts. The doors sniper (W1) goes ${w1.map(usd).join(" → ")}, because a bigger seed means W1 buys in at a higher price right after the owner. With leftovers valued at what the curve can actually pay, every dollar the owner and winning whales take out comes from other traders or the owner's own seed, less fees.`);
  if (last.grads > 0) w(`6. **At ${usd(last.s.seedUsd)}, the curve fills in some runs** (${last.grads} of ${d.runs * last.s.metrics.length}). pump.fun then migrates the coin to PumpSwap; trading after that isn't modeled, so those runs understate later trading.`);
  w();
  w(`## Assumptions`);
  w();
  w(`- Same trader model as \`npm run market\`: made-up but plausible behavior parameters, so compare across seed amounts rather than reading absolute values as forecasts.`);
  w(`- Owner cost = seed + ${RENT_SOL} SOL account rent. Tokens still held at window close are valued together at what selling all of them into the curve would return, split pro rata (no paper gains). Burned tokens are gone, which raises everyone else's share.`);
  w(`- SOL/USD constant at $${solUsd}; attendance is the modeled profile in \`${d.path}\`. Not financial advice.`);

  mkdirSync("reports", { recursive: true });
  const base = `reports/${ev.id}-seed-sweep`;
  writeFileSync(`${base}.md`, L.join("\n") + "\n");
  writeFileSync(
    `${base}-summary.json`,
    JSON.stringify(
      {
        event: ev.id,
        runs: d.runs,
        seed: d.seed0,
        solUsd,
        source: d.source,
        seeds: facts.map((f) => ({
          seedUsd: f.s.seedUsd,
          ownerShareOfSupply: f.share,
          launchMcap: f.launchMcap,
          scenarios: f.s.metrics.map((m) => ({
            id: m.sc.id,
            ownerRoi: { p10: q(m.ownerRoi, 0.1), p50: q(m.ownerRoi, 0.5), p90: q(m.ownerRoi, 0.9) },
            ownerPnlUsd: med(m.ownerRoi) * f.s.costUsd,
            peakMcap: med(m.peak),
            microPnl: med(m.microPnl),
            graduatedRuns: m.grads,
          })),
        })),
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(`${base}-chart.html`, renderSweepChart(d, facts.map((f) => ({ seedUsd: f.s.seedUsd, launchMcap: f.launchMcap }))));
  console.log(L.join("\n"));
  console.log(`\nwrote ${base}.md, ${base}-summary.json, ${base}-chart.html`);
}

function renderSweepChart(d: SweepInput, seeds: Array<{ seedUsd: number; launchMcap: number }>): string {
  const labels = Array.from({ length: d.chartMinutes + 1 }, (_, m) => etClock(d.launch, m));
  const ticks = Array.from({ length: d.chartMinutes / 60 + 1 }, (_, i) => ({ m: i * 60, t: etClock(d.launch, i * 60).replace(/^\S+ /, "").replace(":00", "") }));
  const ids = d.sweeps[0].metrics.map((m) => m.sc.id);
  const data = {
    labels,
    ticks,
    chartMinutes: d.chartMinutes,
    showStart: d.showStart,
    showEnd: d.showEnd,
    seeds: seeds.map((s) => s.seedUsd),
    scenarios: ids.map((id) => ({
      id,
      name: d.sweeps[0].metrics.find((m) => m.sc.id === id)!.sc.short,
      roi: d.sweeps.map((s) => {
        const m = s.metrics.find((x) => x.sc.id === id)!;
        return { p10: q(m.ownerRoi, 0.1), p50: q(m.ownerRoi, 0.5), p90: q(m.ownerRoi, 0.9), usd: q(m.ownerRoi, 0.5) * s.costUsd };
      }),
    })),
    fans: d.sweeps.map((s, i) => ({ seedUsd: s.seedUsd, launchMcap: seeds[i].launchMcap, fan: s.metrics.find((m) => m.sc.id === "S1")!.fan.filter((f) => f.m <= d.chartMinutes) })),
  };
  const roiTable = data.scenarios
    .map((sc) => `<tr><th scope="row">${esc(sc.id)} · ${esc(sc.name)}</th>${sc.roi.map((r) => `<td class="num">${pct(r.p50)}<br><span class="muted">${usd(r.usd)}</span></td>`).join("")}</tr>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Owner Seed Sweep</title>
<style>
${BASE_CSS}
:root { --c1: #2a78d6; --c2: #eb6834; --c3: #1baf7a; --c4: #eda100; --c5: #e87ba4; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --c1: #3987e5; --c2: #d95926; --c3: #199e70; --c4: #c98500; --c5: #d55181; } }
:root[data-theme="dark"] { --c1: #3987e5; --c2: #d95926; --c3: #199e70; --c4: #c98500; --c5: #d55181; }
.muted { color: var(--text-muted); font-size: 12px; }
.series-lbl { font-size: 11.5px; font-weight: 600; fill: var(--text-primary); }
.key { display: inline-block; width: 18px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
.peg-sw { width: 18px; height: 0; border-top: 2px dashed var(--text-muted); display: inline-block; }
.band-sw { width: 18px; height: 10px; background: var(--series-1-fill); display: inline-block; border-radius: 2px; }
.grid4 { display: grid; grid-template-columns: 1fr; gap: 0; }
.grid4 > * { min-width: 0; }
</style>
</head>
<body>
<main>
  <h1>${esc(d.ev.title)}: owner seed sweep</h1>
  <p class="sub">${d.runs} runs per scenario per seed, the same random draws at every amount · micro traders + 4 whales on the pump.fun curve · SOL $${d.solUsd}</p>

  <section class="card" aria-label="Owner ROI by seed amount">
    <p class="panel-title">Owner ROI by seed amount</p>
    <p class="panel-note">Median across runs, creator fees included. Selling scenarios (S3, S4) sit far above holding into the burn (S1, S2, S5).</p>
    <div class="chart-wrap"><svg id="roi" viewBox="0 0 1000 320" role="img" aria-label="Owner ROI by seed amount, one line per scenario"></svg></div>
    <div class="legend" id="roi-legend"></div>
    <div class="scroll" style="margin-top:12px"><table>
      <thead><tr><th>Scenario</th>${data.seeds.map((s) => `<th class="num">Seed ${k$(s)}</th>`).join("")}</tr></thead>
      <tbody>${roiTable}</tbody>
    </table></div>
  </section>

  <section class="card">
    <p class="panel-title">Market cap over the night: S1 organic market, owner holds</p>
    <p class="panel-note">Median (line) and 10th–90th percentile (band) per seed amount, against that seed's attendance value (launch market cap + $1 per seat, dashed). Same y-scale in every panel.</p>
    <div class="legend"><span><i class="sw"></i>Median market cap</span><span><i class="band-sw"></i>10th–90th percentile</span><span><i class="peg-sw"></i>Attendance value</span></div>
  </section>
  <div class="grid4">
    ${data.fans.map((f, i) => `<section class="card" aria-label="Seed ${k$(f.seedUsd)}"><p class="panel-title">Seed ${k$(f.seedUsd)}</p><p class="panel-note">launch market cap ${usd(f.launchMcap)}</p><div class="chart-wrap"><svg id="fan${i}" viewBox="0 0 1000 260" role="img" aria-label="Market cap over time with a ${k$(f.seedUsd)} seed"></svg></div></section>`).join("")}
  </div>
</main>
<div id="tip" role="status" aria-live="polite"></div>
<script>
const D = ${JSON.stringify(data)};
const NS = "http://www.w3.org/2000/svg";
const W = 1000;
const fmt$ = (v) => (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (v) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(0) + "%";
const k$ = (n) => (n >= 1000 ? "$" + n / 1000 + "k" : "$" + n);
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function nice(lo, hi) { const raw = (hi - lo) / 5, p = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw); return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step }; }
const tip = document.getElementById("tip");
function showTip(e, html) { tip.innerHTML = html; tip.style.display = "block"; tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14) + "px"; tip.style.top = e.clientY + 14 + "px"; }
function hideTip() { tip.style.display = "none"; }

// ---- ROI lines: x = seed amount (ordinal), y = ROI ----
(function () {
  const svg = document.getElementById("roi");
  const M = { l: 70, r: 150, t: 16, b: 34 }, H = 320;
  const all = D.scenarios.flatMap((s) => s.roi.map((r) => r.p50));
  const sc = nice(Math.min(0, ...all), Math.max(...all));
  const x = (i) => M.l + (i / (D.seeds.length - 1)) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - (v - sc.min) / (sc.max - sc.min)) * (H - M.t - M.b);
  for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) {
    el("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: Math.abs(v) < 1e-9 ? "var(--axis)" : "var(--grid)" }, svg);
    const t = el("text", { x: M.l - 8, y: y(v) + 4, "text-anchor": "end", class: "lbl" }, svg); t.textContent = fmtPct(v);
  }
  D.seeds.forEach((s, i) => { const t = el("text", { x: x(i), y: H - 10, "text-anchor": "middle", class: "lbl" }, svg); t.textContent = "seed " + k$(s); });
  const legend = document.getElementById("roi-legend");
  D.scenarios.forEach((s, j) => {
    const color = "var(--c" + (j + 1) + ")";
    el("path", { d: "M" + s.roi.map((r, i) => x(i) + "," + y(r.p50)).join(" L"), fill: "none", stroke: color, "stroke-width": 2 }, svg);
    s.roi.forEach((r, i) => {
      const c = el("circle", { cx: x(i), cy: y(r.p50), r: 5, fill: color, stroke: "var(--surface)", "stroke-width": 2 }, svg);
      const hit = el("circle", { cx: x(i), cy: y(r.p50), r: 14, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (e) => showTip(e, '<div class="t">' + s.id + " · seed " + k$(D.seeds[i]) + '</div><div class="r">Owner ROI <b>' + fmtPct(r.p50) + '</b></div><div class="r">10th–90th <b>' + fmtPct(r.p10) + " to " + fmtPct(r.p90) + '</b></div><div class="r">Owner P&amp;L <b>' + fmt$(r.usd) + "</b></div>"));
      hit.addEventListener("pointerleave", hideTip);
    });
    const item = document.createElement("span"); item.innerHTML = '<i class="key" style="background:' + color + '"></i>' + s.id + " · " + s.name; legend.appendChild(item);
  });
  // two group labels at the right edge: owner sells (S3, S4) vs owner holds (S1, S2, S5)
  const lastIdx = D.seeds.length - 1;
  const groupY = (ids) => { const v = D.scenarios.filter((s) => ids.includes(s.id)).map((s) => s.roi[lastIdx].p50); return y(v.reduce((a, b) => a + b, 0) / v.length); };
  [[["S3", "S4"], "owner sells (S3, S4)"], [["S1", "S2", "S5"], "owner holds (S1, S2, S5)"]].forEach(([ids, text]) => {
    const t = el("text", { x: x(lastIdx) + 12, y: groupY(ids) + 4, class: "series-lbl" }, svg); t.textContent = text;
  });
})();

// ---- S1 fan per seed, shared y-scale ----
(function () {
  const M = { l: 72, r: 20, t: 26, b: 30 }, H = 260;
  const yMax = nice(0, Math.max(...D.fans.flatMap((f) => f.fan.map((p) => Math.max(p.p90, p.peg))))) ;
  const x = (m) => M.l + (m / D.chartMinutes) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - v / yMax.max) * (H - M.t - M.b);
  const line = (pts) => "M" + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L");
  D.fans.forEach((f, i) => {
    const svg = document.getElementById("fan" + i);
    el("rect", { x: x(D.showStart), y: M.t, width: x(D.showEnd) - x(D.showStart), height: H - M.t - M.b, fill: "var(--band)" }, svg);
    const a = el("text", { x: x(D.showStart) + 4, y: M.t - 10, class: "ann" }, svg); a.textContent = "show";
    for (let v = 0; v <= yMax.max + 1e-9; v += yMax.step) {
      el("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: v === 0 ? "var(--axis)" : "var(--grid)" }, svg);
      const t = el("text", { x: M.l - 8, y: y(v) + 4, "text-anchor": "end", class: "lbl" }, svg); t.textContent = fmt$(v);
    }
    D.ticks.forEach((tk) => { const t = el("text", { x: x(tk.m), y: H - 8, "text-anchor": "middle", class: "lbl" }, svg); t.textContent = tk.t; });
    const top = f.fan.map((p) => [x(p.m), y(p.p90)]);
    const bot = f.fan.map((p) => [x(p.m), y(p.p10)]).reverse();
    el("path", { d: line(top) + " L" + bot.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" L") + " Z", fill: "var(--series-1-fill)" }, svg);
    el("path", { d: line(f.fan.map((p) => [x(p.m), y(p.peg)])), fill: "none", stroke: "var(--text-muted)", "stroke-width": 1.5, "stroke-dasharray": "5 4" }, svg);
    el("path", { d: line(f.fan.map((p) => [x(p.m), y(p.p50)])), fill: "none", stroke: "var(--series-1)", "stroke-width": 2 }, svg);
    const g = el("g", { style: "display:none" }, svg);
    const vl = el("line", { y1: M.t, y2: H - M.b, stroke: "var(--text-muted)" }, g);
    const dot = el("circle", { r: 5, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 }, g);
    const hit = el("rect", { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (e) => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const m = ((loc.x - M.l) / (W - M.l - M.r)) * D.chartMinutes;
      const p = f.fan.reduce((a, b) => (Math.abs(b.m - m) < Math.abs(a.m - m) ? b : a));
      g.style.display = ""; vl.setAttribute("x1", x(p.m)); vl.setAttribute("x2", x(p.m)); dot.setAttribute("cx", x(p.m)); dot.setAttribute("cy", y(p.p50));
      showTip(e, '<div class="t">Seed ' + k$(f.seedUsd) + " · " + D.labels[p.m] + ' ET</div><div class="r">Seats <b>' + p.seats.toLocaleString("en-US") + '</b></div><div class="r">Attendance value <b>' + fmt$(p.peg) + '</b></div><div class="r">Median market cap <b>' + fmt$(p.p50) + '</b></div><div class="r">10th–90th <b>' + fmt$(p.p10) + " – " + fmt$(p.p90) + "</b></div>");
    });
    hit.addEventListener("pointerleave", () => { g.style.display = "none"; hideTip(); });
  });
})();
</script>
</body>
</html>
`;
}
