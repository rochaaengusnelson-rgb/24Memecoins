import { describe, expect, it } from "vitest";
import { Curve, seatsAt } from "../src/model/curve.js";

const init = { vS: 30_000_000_000n, vT: 1_073_000_000_000_000n, realT: 793_100_000_000_000n };
const fees = { protocol: 95n, creator: 30n };

describe("Curve", () => {
  it("keeps k constant across trades", () => {
    const c = new Curve(init, fees);
    c.buyGross(2_702_702_702n);
    c.sell(10_000_000_000_000n);
    expect(c.vS * c.vT >= c.k).toBe(true);
    expect(Number(c.vS * c.vT - c.k) / Number(c.k)).toBeLessThan(1e-9);
  });
  it("round trip loses exactly the fees (both sides)", () => {
    const c = new Curve(init, fees);
    const b = c.buyGross(1_000_000_000n);
    const s = c.sell(b.tokens);
    const loss = Number(b.solGross - s.solNet) / Number(b.solGross);
    expect(loss).toBeGreaterThan(0.024);
    expect(loss).toBeLessThan(0.026);
    expect(c.vS).toBeGreaterThanOrEqual(init.vS);
  });
  it("vSForPrice hits the target price", () => {
    const c = new Curve(init, fees);
    const target = c.price() * 1.088;
    c.buyNet(c.vSForPrice(target) - c.vS);
    expect(Math.abs(c.price() / target - 1)).toBeLessThan(1e-6);
  });
  it("accrues creator fees on volume", () => {
    const c = new Curve(init, fees);
    c.buyNet(1_000_000_000n);
    expect(c.creatorFees).toBe(3_000_000n);
  });
});

describe("seatsAt", () => {
  const pts: Array<[number, number]> = [[0, 100], [10, 200], [20, 0]];
  it("interpolates and clamps", () => {
    expect(seatsAt(pts, -5)).toBe(100);
    expect(seatsAt(pts, 5)).toBe(150);
    expect(seatsAt(pts, 15)).toBe(100);
    expect(seatsAt(pts, 99)).toBe(0);
  });
});
