/** Self-contained HTML small multiples for the market scenarios: seats, then one fan chart per scenario. */
import { BASE_CSS, esc } from "./chart.js";

export interface MarketChartInput {
  title: string;
  subtitle: string;
  labels: string[];
  ticks: Array<{ m: number; t: string }>;
  chartMinutes: number;
  showStart: number;
  showEnd: number;
  capacity: number;
  launchMcap: number;
  seats: Array<{ m: number; seats: number }>;
  panels: Array<{
    id: string;
    name: string;
    stats: string;
    fan: Array<{ m: number; peg: number; p10: number; p50: number; p90: number }>;
    marks: Array<{ who: string; side: "buy" | "sell"; minute: number; usd: number }>;
  }>;
}

export function renderMarketChart(d: MarketChartInput): string {
  const panelsHtml = d.panels
    .map(
      (p, i) => `
  <section class="card" aria-label="${esc(p.name)}">
    <p class="panel-title">${esc(p.id)} · ${esc(p.name)}</p>
    <p class="panel-note">${esc(p.stats)}</p>
    <div class="chart-wrap"><svg id="p${i}" viewBox="0 0 1000 250" role="img" aria-label="Market cap over time for ${esc(p.id)}"></svg></div>
  </section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Event Coin Market</title>
<style>
${BASE_CSS}
.peg-sw { width: 18px; height: 0; border-top: 2px dashed var(--text-muted); display: inline-block; }
.band-sw { width: 18px; height: 10px; background: var(--series-1-fill); display: inline-block; border-radius: 2px; }
.mark-lbl { fill: var(--text-primary); font-size: 10.5px; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>${esc(d.title)}</h1>
  <p class="sub">${esc(d.subtitle)}</p>
  <section class="card">
    <p class="panel-title">Seats in the building</p>
    <p class="panel-note">Attendance value = launch market cap $${Math.round(d.launchMcap).toLocaleString("en-US")} + $1 per seat. Capacity ${d.capacity.toLocaleString("en-US")}.</p>
    <div class="chart-wrap"><svg id="seats" viewBox="0 0 1000 200" role="img" aria-label="Seats occupied over time"></svg></div>
    <div class="legend">
      <span><i class="sw"></i>Median market cap</span>
      <span><i class="band-sw"></i>10th–90th percentile of runs</span>
      <span><i class="peg-sw"></i>Attendance value ($1 per seat)</span>
      <span>▲ buy / ▼ sell by whales (W1–W4) and the owner in one sample run</span>
    </div>
  </section>
  ${panelsHtml}
</main>
<div id="tip" role="status" aria-live="polite"></div>
<script>
const D = ${JSON.stringify(d)};
const NS = "http://www.w3.org/2000/svg";
const M = { l: 70, r: 24, t: 26, b: 28 };
const W = 1000;
const fmt$ = (v) => (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function niceScale(v) { const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw); return { max: Math.ceil(v / step) * step, step }; }
const x = (m) => M.l + (m / D.chartMinutes) * (W - M.l - M.r);
function frame(svg, H, scale, fmt) {
  const y = (v) => M.t + (1 - v / scale.max) * (H - M.t - M.b);
  el("rect", { x: x(D.showStart), y: M.t, width: x(D.showEnd) - x(D.showStart), height: H - M.t - M.b, fill: "var(--band)" }, svg);
  const a = el("text", { x: x(0), y: M.t - 10, class: "ann" }, svg); a.textContent = "coin live · doors";
  const b = el("text", { x: x(D.showStart) + 4, y: M.t - 10, class: "ann" }, svg); b.textContent = "show";
  const c = el("text", { x: x(D.showEnd) + 4, y: M.t - 10, class: "ann" }, svg); c.textContent = "crowd leaves";
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
    el("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: v === 0 ? "var(--axis)" : "var(--grid)" }, svg);
    const t = el("text", { x: M.l - 8, y: y(v) + 4, "text-anchor": "end", class: "lbl" }, svg); t.textContent = fmt(v);
  }
  for (const tk of D.ticks) { const t = el("text", { x: x(tk.m), y: H - 8, "text-anchor": "middle", class: "lbl" }, svg); t.textContent = tk.t; }
  return y;
}
const line = (pts) => "M" + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L");

// seats panel
const sSvg = document.getElementById("seats");
const sy = frame(sSvg, 200, niceScale(D.capacity), (v) => v.toLocaleString("en-US"));
el("path", { d: line(D.seats.map((s) => [x(s.m), sy(s.seats)])), fill: "none", stroke: "var(--series-1)", "stroke-width": 2 }, sSvg);

// market panels share one y scale
const yMax = Math.max(...D.panels.flatMap((p) => p.fan.map((f) => Math.max(f.p90, f.peg))));
const scale = niceScale(yMax);
const tip = document.getElementById("tip");
D.panels.forEach((p, i) => {
  const svg = document.getElementById("p" + i);
  const H = 250;
  const y = frame(svg, H, scale, fmt$);
  const top = p.fan.map((f) => [x(f.m), y(f.p90)]);
  const bot = p.fan.map((f) => [x(f.m), y(f.p10)]).reverse();
  el("path", { d: line(top) + " L" + bot.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" L") + " Z", fill: "var(--series-1-fill)" }, svg);
  el("path", { d: line(p.fan.map((f) => [x(f.m), y(f.peg)])), fill: "none", stroke: "var(--text-muted)", "stroke-width": 1.5, "stroke-dasharray": "5 4" }, svg);
  el("path", { d: line(p.fan.map((f) => [x(f.m), y(f.p50)])), fill: "none", stroke: "var(--series-1)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  // trade marks on the median line, staggered so labels don't collide
  const used = [];
  const at = (m) => { const f = p.fan.reduce((a, b) => (Math.abs(b.m - m) < Math.abs(a.m - m) ? b : a)); return f.p50; };
  p.marks.forEach((k) => {
    const cx = x(k.minute), cy = y(at(k.minute));
    let off = k.side === "buy" ? 16 : -16;
    while (used.some((u) => Math.abs(u[0] - cx) < 34 && Math.abs(u[1] - (cy + off)) < 12)) off += k.side === "buy" ? 12 : -12;
    used.push([cx, cy + off]);
    const tri = k.side === "buy" ? [[cx, cy + off - 9], [cx - 5, cy + off - 1], [cx + 5, cy + off - 1]] : [[cx, cy + off + 9], [cx - 5, cy + off + 1], [cx + 5, cy + off + 1]];
    el("polygon", { points: tri.map((q) => q.join(",")).join(" "), fill: "var(--drop)" }, svg);
    const t = el("text", { x: cx + 7, y: cy + off + (k.side === "buy" ? -1 : 9), class: "mark-lbl" }, svg); t.textContent = k.who;
  });
  // hover
  const g = el("g", { style: "display:none" }, svg);
  const vl = el("line", { y1: M.t, y2: H - M.b, stroke: "var(--text-muted)" }, g);
  const dot = el("circle", { r: 5, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 }, g);
  const hit = el("rect", { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: "transparent" }, svg);
  hit.addEventListener("pointermove", (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const m = ((loc.x - M.l) / (W - M.l - M.r)) * D.chartMinutes;
    const f = p.fan.reduce((a, b) => (Math.abs(b.m - m) < Math.abs(a.m - m) ? b : a));
    const s = D.seats.find((q) => q.m === f.m) || { seats: 0 };
    g.style.display = ""; vl.setAttribute("x1", x(f.m)); vl.setAttribute("x2", x(f.m)); dot.setAttribute("cx", x(f.m)); dot.setAttribute("cy", y(f.p50));
    const near = p.marks.filter((k) => Math.abs(k.minute - f.m) <= 3);
    tip.innerHTML = '<div class="t">' + p.id + " · " + D.labels[f.m] + " ET</div>" +
      '<div class="r">Seats <b>' + s.seats.toLocaleString("en-US") + "</b></div>" +
      '<div class="r">Attendance value <b>' + fmt$(f.peg) + "</b></div>" +
      '<div class="r">Median market cap <b>' + fmt$(f.p50) + "</b></div>" +
      '<div class="r">10th–90th pct <b>' + fmt$(f.p10) + " – " + fmt$(f.p90) + "</b></div>" +
      near.map((k) => '<div class="r">' + k.who + " " + k.side + " <b>" + fmt$(k.usd) + "</b></div>").join("");
    tip.style.display = "block";
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14) + "px";
    tip.style.top = e.clientY + 14 + "px";
  });
  hit.addEventListener("pointerleave", () => { g.style.display = "none"; tip.style.display = "none"; });
});
</script>
</body>
</html>
`;
}
