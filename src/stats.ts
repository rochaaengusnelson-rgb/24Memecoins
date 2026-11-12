/** Small helpers shared by the report writers. */

export const RENT_SOL = 0.0092; // mint + curve + ATA rent, from the mainnet dry run

/** Linear-interpolated quantile. */
export const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
export const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
/** "median <sub>(p10 to p90)</sub>" */
export const band = (xs: number[], f: (n: number) => string) => `${f(q(xs, 0.5))} <sub>(${f(q(xs, 0.1))} to ${f(q(xs, 0.9))})</sub>`;
