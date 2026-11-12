import { describe, expect, it } from "vitest";
import { Curve } from "../src/model/curve.js";
import { DEFAULT_MICRO, DEFAULT_WHALES, simulate, type MarketParams } from "../src/model/market.js";

const init = { vS: 30_000_000_000n, vT: 1_073_000_000_000_000n, realT: 793_100_000_000_000n };
const fees = { protocol: 95n, creator: 30n };
const params: MarketParams = {
  solUsd: 185,
  supply: 1e15,
  capacity: 19_500,
  points: [[0, 0], [60, 8500], [120, 18300], [150, 19200], [325, 19200], [330, 18700], [350, 5000], [390, 0]],
  showStart: 120,
  showEnd: 330,
  windowMin: 1440,
  perSeatUsd: 1,
  ownerSeedLamports: 2_702_702_702n,
  burnShareAtFullHouse: 1,
  micro: DEFAULT_MICRO,
  whales: DEFAULT_WHALES,
  owner: { kind: "hold-burn" },
};

describe("market simulation", () => {
  it("is deterministic for a seed", () => {
    const a = simulate(new Curve(init, fees), params, 42);
    const b = simulate(new Curve(init, fees), params, 42);
    expect(a.peakMcap).toBe(b.peakMcap);
    expect(a.micro.solIn).toBe(b.micro.solIn);
    expect(simulate(new Curve(init, fees), params, 43).peakMcap).not.toBe(a.peakMcap);
  });

  it("conserves SOL: money in = money out + fees + SOL left in the curve", () => {
    const curve = new Curve(init, fees);
    const r = simulate(curve, { ...params, pegKeeper: { inventoryUsd: 1500, bandPct: 0.05, maxUsdPerMin: 400, budgetUsd: 4000 } }, 7);
    const ins = r.owner.cost + r.micro.solIn + r.whales.reduce((a, w) => a + w.solIn, 0n) + (r.keeper?.solIn ?? 0n);
    const outs = r.owner.proceeds + r.micro.solOut + r.whales.reduce((a, w) => a + w.solOut, 0n) + (r.keeper?.solOut ?? 0n);
    // owner seed's own creator fee was zeroed in the sim; protocol fees are all counted
    const feesPaid = curve.protocolFees + curve.creatorFees;
    const diff = ins - outs - feesPaid - curve.realSol;
    // only rounding plus the owner seed's creator fee (excluded from creatorFees) may remain
    expect(diff >= 0n).toBe(true);
    expect(Number(diff)).toBeLessThan(Number(params.ownerSeedLamports) * 0.004);
  });

  it("burns the owner bag only when holding", () => {
    const hold = simulate(new Curve(init, fees), params, 1);
    expect(hold.owner.burned > 0n).toBe(true);
    const sold = simulate(new Curve(init, fees), { ...params, owner: { kind: "sell", sellMinute: 225 } }, 1);
    expect(sold.owner.burned).toBe(0n);
    expect(sold.owner.proceeds > 0n).toBe(true);
  });
});
