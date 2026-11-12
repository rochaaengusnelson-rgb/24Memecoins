/** Self-contained HTML time chart for the ROI report: seats in the building and attendance value, same time axis. */

export interface ChartInput {
  title: string;
  subtitle: string;
  startIso: string;
  capacity: number;
  launchMcap: number;
  perSeat: number;
  showStartMinute: number;
  showEndMinute: number;
  chartMinutes: number;
  rows: Array<{ m: number; seats: number; peg: number }>;
  sales: Array<{ id: string; tag: string; label: string; m: number; peg: number; after: number; proceedsUsd: number }>;
  roi: Array<{ id: string; name: string; roi: number; totalUsd: number; crowdUsd: number }>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function clock(startIso: string, minute: number, withDay = false) {
  return new Date(Date.parse(startIso) + minute * 60_000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    ...(withDay ? { weekday: "short" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

export function renderChart(d: ChartInput): string {
  const labels = Array.from({ length: d.chartMinutes + 1 }, (_, m) => clock(d.startIso, m, true));
  const ticks = [];
  for (let m = 0; m <= d.chartMinutes; m += 60) ticks.push({ m, t: clock(d.startIso, m).replace(":00", "") });
  const data = { ...d, labels, ticks };
  const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
  const money = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const roiRows = d.roi
    .map((r) => `<tr><th scope="row">${r.id}</th><td>${esc(r.name)}</td><td class="num">${money(r.totalUsd)}</td><td class="num"><strong>${pct(r.roi)}</strong></td><td class="num">${money(r.crowdUsd)}</td></tr>`)
    .join("");
  const saleItems = d.sales
    .filter((s) => s.m < d.chartMinutes)
    .map((s) => `<li><b>${esc(s.tag)}</b> ${labels[s.m]} ET · ${esc(s.label.replace(/^[A-E]: /, ""))} · price drops ${pct(s.after / s.peg - 1)} (${money(s.after - s.peg)} market cap) · owner gets ${money(s.proceedsUsd)}</li>`)
    .join("");
  const tableRows = d.rows
    .filter((r) => r.m % 15 === 0)
    .map((r) => `<tr><td>${labels[r.m]}</td><td class="num">${r.seats.toLocaleString("en-US")}</td><td class="num">${money(r.peg - d.launchMcap)}</td><td class="num">${money(r.peg)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Attendance Coin Chart</title>
<style>
:root {
  color-scheme: light;
  --surface: #fcfcfb; --page: #f4f3ef; --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #77756f;
  --grid: #e6e4de; --axis: #bdbab2; --band: #eeece6; --series-1: #2a78d6; --series-1-fill: rgba(42,120,214,.12);
  --drop: #0b0b0b;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --page: #121211; --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #96958c;
    --grid: #2c2c2a; --axis: #4a4945; --band: #232321; --series-1: #3987e5; --series-1-fill: rgba(57,135,229,.18);
    --drop: #f0efec;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --page: #121211; --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #96958c;
  --grid: #2c2c2a; --axis: #4a4945; --band: #232321; --series-1: #3987e5; --series-1-fill: rgba(57,135,229,.18);
  --drop: #f0efec;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text-primary); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color: var(--text-secondary); margin: 0 0 16px; }
.card { background: var(--surface); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.panel-title { font-weight: 600; margin: 0; }
.panel-note { color: var(--text-secondary); margin: 2px 0 6px; font-size: 13px; }
svg { display: block; width: 100%; min-width: 680px; height: auto; overflow: visible; }
.chart-wrap { overflow-x: auto; }
.tick text, .lbl { fill: var(--text-muted); font-size: 11px; }
.ann { fill: var(--text-secondary); font-size: 11px; }
.sale-lbl { fill: var(--text-primary); font-size: 11.5px; font-weight: 600; }
.sale-sub { fill: var(--text-secondary); font-size: 11px; }
#tip { position: fixed; pointer-events: none; background: var(--surface); color: var(--text-primary); border: 1px solid var(--axis);
  border-radius: 8px; padding: 8px 10px; font-size: 12.5px; box-shadow: 0 4px 16px rgba(0,0,0,.12); display: none; min-width: 190px; z-index: 5; }
#tip .t { font-weight: 600; margin-bottom: 4px; }
#tip .r { display: flex; justify-content: space-between; gap: 16px; color: var(--text-secondary); }
#tip .r b { color: var(--text-primary); font-weight: 600; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--grid); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
thead th { color: var(--text-secondary); font-weight: 600; }
details summary { cursor: pointer; color: var(--text-secondary); }
.scroll { overflow-x: auto; }
.legend { display: flex; flex-wrap: wrap; gap: 16px; color: var(--text-secondary); font-size: 12.5px; margin-top: 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 18px; height: 2px; background: var(--series-1); display: inline-block; }
.sw.drop { background: none; border-left: 2px dashed var(--drop); width: 2px; height: 12px; }
.sales { margin: 10px 0 0; padding: 0; list-style: none; color: var(--text-secondary); font-size: 12.5px; display: grid; gap: 4px; }
.sales b { color: var(--text-primary); display: inline-block; min-width: 26px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--surface); border: 2px solid var(--drop); display: inline-block; }
</style>
</head>
<body>
<main>
  <h1>${esc(d.title)}</h1>
  <p class="sub">${esc(d.subtitle)}</p>

  <section class="card" aria-label="Seats in the building over time">
    <p class="panel-title">Seats in the building</p>
    <p class="panel-note">Counted from 0 at launch · capacity ${d.capacity.toLocaleString("en-US")}</p>
    <div class="chart-wrap"><svg id="seats" viewBox="0 0 1000 240" role="img" aria-label="Seats occupied from coin launch to after the show"></svg></div>
  </section>

  <section class="card" aria-label="Attendance value over time">
    <p class="panel-title">Attendance value (market cap above launch)</p>
    <p class="panel-note">$0 at 0 seats · +$${d.perSeat} per seat · launch market cap ${money(d.launchMcap)} (pump.fun can't list at a literal $0)</p>
    <div class="chart-wrap"><svg id="value" viewBox="0 0 1000 300" role="img" aria-label="Attendance value in dollars, with owner sale price drops"></svg></div>
    <div class="legend">
      <span><i class="sw"></i>Pegged value (crowd holds it 1:1 with seats)</span>
      <span><i class="sw drop"></i><i class="dot"></i>Owner sale: instant drop before buyers restore the peg</span>
    </div>
    <ul class="sales">${saleItems}</ul>
  </section>

  <section class="card" aria-label="Owner ROI by scenario">
    <p class="panel-title">Owner ROI by scenario</p>
    <p class="panel-note">Owner cost ≈ $501.70 ($500 seed + account rent). Crowd net = all other buyers combined.</p>
    <div class="scroll"><table>
      <thead><tr><th></th><th>Scenario</th><th class="num">Owner gets back</th><th class="num">Owner ROI</th><th class="num">Crowd net</th></tr></thead>
      <tbody>${roiRows}</tbody>
    </table></div>
  </section>

  <section class="card">
    <details><summary>Data table (every 15 minutes)</summary>
      <div class="scroll"><table>
        <thead><tr><th>Time (ET)</th><th class="num">Seats</th><th class="num">Attendance value</th><th class="num">Market cap</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>
    </details>
  </section>
</main>
<div id="tip" role="status" aria-live="polite"></div>
<script>
const D = ${JSON.stringify(data)};
const NS = "http://www.w3.org/2000/svg";
const M = { l: 64, r: 130, t: 30, b: 30 };
const W = 1000;
const fmt$ = (v) => (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function niceScale(v) {
  // round step (1/2/5 x 10^k) giving 4-5 gridlines; max is the first step multiple >= v
  const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
  return { max: Math.ceil(v / step) * step, step };
}

function panel(svg, H, scale, yFmt, key) {
  const yMax = scale.max;
  const x = (m) => M.l + (m / D.chartMinutes) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - v / yMax) * (H - M.t - M.b);
  // show band
  el("rect", { x: x(D.showStartMinute), y: M.t, width: x(D.showEndMinute) - x(D.showStartMinute), height: H - M.t - M.b, fill: "var(--band)" }, svg);
  el("line", { x1: x(D.showStartMinute), x2: x(D.showStartMinute), y1: M.t - 6, y2: H - M.b, stroke: "var(--axis)", "stroke-width": 1 }, svg);
  const preLbl = el("text", { x: x(0), y: M.t - 10, class: "ann" }, svg); preLbl.textContent = "coin live · doors · pre-show";
  const showLbl = el("text", { x: x(D.showStartMinute) + 4, y: M.t - 10, class: "ann" }, svg); showLbl.textContent = "show " + D.labels[D.showStartMinute] + " – " + D.labels[D.showEndMinute];
  el("line", { x1: x(D.showEndMinute), x2: x(D.showEndMinute), y1: M.t - 6, y2: H - M.b, stroke: "var(--axis)", "stroke-width": 1 }, svg);
  const endLbl = el("text", { x: x(D.showEndMinute) + 4, y: M.t - 10, class: "ann" }, svg); endLbl.textContent = "headliner ends · crowd leaves";
  // grid + y ticks
  for (let v = 0; v <= yMax + 1e-9; v += scale.step) {
    const i = v;
    el("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: v === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }, svg);
    const t = el("text", { x: M.l - 8, y: y(v) + 4, "text-anchor": "end", class: "lbl" }, svg); t.textContent = yFmt(v);
  }
  for (const tk of D.ticks) {
    const t = el("text", { x: x(tk.m), y: H - 8, "text-anchor": "middle", class: "lbl" }, svg); t.textContent = tk.t;
  }
  // area + line
  const pts = D.rows.map((r) => [x(r.m), y(key(r))]);
  el("path", { d: "M" + x(0) + "," + y(0) + " L" + pts.map((p) => p.join(",")).join(" L") + " L" + x(D.chartMinutes) + "," + y(0) + " Z", fill: "var(--series-1-fill)" }, svg);
  el("path", { d: "M" + pts.map((p) => p.join(",")).join(" L"), fill: "none", stroke: "var(--series-1)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  return { x, y, H };
}

const seatsSvg = document.getElementById("seats");
const valueSvg = document.getElementById("value");
const sMax = niceScale(D.capacity);
const vals = D.rows.map((r) => r.peg - D.launchMcap);
const vMax = niceScale(Math.max(...vals));
const P1 = panel(seatsSvg, 240, sMax, (v) => v.toLocaleString("en-US"), (r) => r.seats);
const P2 = panel(valueSvg, 300, vMax, (v) => fmt$(v), (r) => r.peg - D.launchMcap);
// capacity reference on the seats panel
el("line", { x1: M.l, x2: W - M.r, y1: P1.y(D.capacity), y2: P1.y(D.capacity), stroke: "var(--text-muted)", "stroke-dasharray": "3 4", "stroke-width": 1 }, seatsSvg);
const capL = el("text", { x: W - M.r + 6, y: P1.y(D.capacity) + 4, class: "ann" }, seatsSvg); capL.textContent = "capacity " + D.capacity.toLocaleString("en-US");
const lastSeat = D.rows.reduce((a, r) => (r.seats > a.seats ? r : a), D.rows[0]);
const pk = el("text", { x: W - M.r + 6, y: P1.y(D.capacity) + 18, class: "ann" }, seatsSvg); pk.textContent = "peak " + lastSeat.seats.toLocaleString("en-US");
// launch marker
for (const [P, svg] of [[P1, seatsSvg], [P2, valueSvg]]) {
  el("circle", { cx: P.x(0), cy: P.y(0), r: 4.5, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 }, svg);
}
const lz = el("text", { x: P2.x(0) + 14, y: P2.y(0) - 10, class: "ann" }, valueSvg); lz.textContent = D.labels[0] + " coin live: $0 at 0 seats";

// owner sales: drop line from peg to post-sale value, grouped by minute
const byMinute = {};
for (const s of D.sales) (byMinute[s.m] = byMinute[s.m] || []).push(s);
for (const m in byMinute) {
  const group = byMinute[m].sort((a, b) => b.after - a.after);
  const xs = group.map((_, i) => P2.x(+m) + (i - (group.length - 1) / 2) * 8);
  const leftSide = P2.x(+m) > M.l + (W - M.l - M.r) * 0.55;
  group.forEach((s, i) => {
    const cx = xs[i];
    const yPeg = P2.y(s.peg - D.launchMcap), yAfter = P2.y(s.after - D.launchMcap);
    el("line", { x1: cx, x2: cx, y1: yPeg, y2: yAfter, stroke: "var(--drop)", "stroke-width": 1.5, "stroke-dasharray": "4 3" }, valueSvg);
    el("circle", { cx, cy: yAfter, r: 5, fill: "var(--surface)", stroke: "var(--drop)", "stroke-width": 2 }, valueSvg);
    const lx = leftSide ? Math.min(...xs) - 10 : Math.max(...xs) + 10;
    const t = el("text", { x: lx, y: yAfter + 4, class: "sale-lbl", "text-anchor": leftSide ? "end" : "start" }, valueSvg);
    t.textContent = s.tag;
  });
}

// crosshair + tooltip across both panels
const tip = document.getElementById("tip");
const guides = [[seatsSvg, P1], [valueSvg, P2]].map(([svg, P]) => {
  const g = el("g", { style: "display:none" }, svg);
  const line = el("line", { y1: M.t, y2: P.H - M.b, stroke: "var(--text-muted)", "stroke-width": 1 }, g);
  const dot = el("circle", { r: 5, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 }, g);
  return { svg, P, g, line, dot };
});
function show(evt, svg) {
  const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
  const m = Math.max(0, Math.min(D.chartMinutes, Math.round(((loc.x - M.l) / (W - M.l - M.r)) * D.chartMinutes)));
  const r = D.rows.find((q) => q.m === m) || D.rows[D.rows.length - 1];
  for (const gd of guides) {
    const X = gd.P.x(r.m);
    gd.g.style.display = "";
    gd.line.setAttribute("x1", X); gd.line.setAttribute("x2", X);
    gd.dot.setAttribute("cx", X);
    gd.dot.setAttribute("cy", gd.svg === seatsSvg ? gd.P.y(r.seats) : gd.P.y(r.peg - D.launchMcap));
  }
  const sale = D.sales.filter((s) => Math.abs(s.m - m) <= 2);
  tip.innerHTML = '<div class="t">' + D.labels[r.m] + " ET</div>" +
    '<div class="r">Seats <b>' + r.seats.toLocaleString("en-US") + "</b></div>" +
    '<div class="r">Fill <b>' + ((r.seats / D.capacity) * 100).toFixed(1) + "%</b></div>" +
    '<div class="r">Attendance value <b>' + fmt$(r.peg - D.launchMcap) + "</b></div>" +
    '<div class="r">Market cap <b>' + fmt$(r.peg) + "</b></div>" +
    sale.map((s) => '<div class="r">' + s.label + " <b>" + fmt$(s.after - s.peg) + "</b></div>").join("");
  tip.style.display = "block";
  const tx = Math.min(window.innerWidth - tip.offsetWidth - 12, evt.clientX + 14);
  tip.style.left = tx + "px"; tip.style.top = (evt.clientY + 14) + "px";
}
function hide() { tip.style.display = "none"; for (const gd of guides) gd.g.style.display = "none"; }
for (const svg of [seatsSvg, valueSvg]) {
  const hit = el("rect", { x: M.l, y: 0, width: W - M.l - M.r, height: svg.viewBox.baseVal.height, fill: "transparent" }, svg);
  hit.addEventListener("pointermove", (e) => show(e, svg));
  hit.addEventListener("pointerleave", hide);
}
</script>
</body>
</html>
`;
}
