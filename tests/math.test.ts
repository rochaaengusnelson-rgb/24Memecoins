import { describe, expect, it } from "vitest";
import { burnAmount, fillRate, isStale, usdToLamports, windowEndsAt, windowOpen } from "../src/math.js";
import { EventConfig, loadEvent, totalCapacity } from "../src/event.js";

describe("usdToLamports", () => {
  it("converts $500 at $200/SOL to 2.5 SOL", () => {
    expect(usdToLamports(500, 200)).toBe(2_500_000_000n);
  });
  it("adds slippage headroom", () => {
    expect(usdToLamports(500, 200, 300)).toBe(2_575_000_000n);
  });
  it("rejects a zero or negative price", () => {
    expect(() => usdToLamports(500, 0)).toThrow();
    expect(() => usdToLamports(500, -1)).toThrow();
  });
});

describe("fillRate / burnAmount", () => {
  it("clamps to [0,1]", () => {
    expect(fillRate(30_000, 24_000)).toBe(1);
    expect(fillRate(-5, 24_000)).toBe(0);
  });
  it("burns the fill share of the owner bag", () => {
    const fill = fillRate(18_000, 24_000); // 75%
    expect(burnAmount(1_000_000n, fill, 1)).toBe(750_000n);
    expect(burnAmount(1_000_000n, fill, 0.5)).toBe(375_000n);
    expect(burnAmount(1_000_000n, 1, 1)).toBe(1_000_000n);
  });
});

describe("window", () => {
  it("runs 24h from launch", () => {
    const w = { launchedAt: 1_000, windowHours: 24 };
    expect(windowEndsAt(w)).toBe(1_000 + 86_400);
    expect(windowOpen(w, 1_000 + 86_399)).toBe(true);
    expect(windowOpen(w, 1_000 + 86_400)).toBe(false);
  });
  it("flags stale oracle values", () => {
    expect(isStale(1_000, 600, 1_500)).toBe(false);
    expect(isStale(1_000, 600, 1_601)).toBe(true);
  });
});

describe("example event", () => {
  it("parses and totals arena + 35 theaters", () => {
    const ev = loadEvent("events/example-la-arena-nyc-broadcast.json");
    expect(totalCapacity(ev)).toBe(24_000);
    expect(ev.venues[1].locations).toBe(35);
    expect(ev.funding.usd).toBe(500);
    expect(ev.rules.windowHours).toBe(24);
  });
  it("rejects a bad symbol length", () => {
    const ev = loadEvent("events/example-la-arena-nyc-broadcast.json");
    expect(() => EventConfig.parse({ ...ev, coin: { ...ev.coin, symbol: "WAYTOOLONGSYMBOL" } })).toThrow();
  });
});
