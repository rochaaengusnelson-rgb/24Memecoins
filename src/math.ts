/** Pure helpers: no network, fully unit-tested. */

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** USD amount -> lamports at a given SOL/USD price, plus slippage headroom in bps. */
export function usdToLamports(usd: number, solUsd: number, slippageBps = 0): bigint {
  if (!(usd > 0)) throw new Error(`usd must be > 0, got ${usd}`);
  if (!(solUsd > 0)) throw new Error(`SOL/USD price must be > 0, got ${solUsd}`);
  // Work in micro-USD to avoid float drift on the lamport amount.
  const microUsd = BigInt(Math.round(usd * 1e6));
  const microPrice = BigInt(Math.round(solUsd * 1e6));
  const base = (microUsd * LAMPORTS_PER_SOL) / microPrice;
  return base + (base * BigInt(slippageBps)) / 10_000n;
}

export function lamportsToSol(l: bigint): number {
  return Number(l) / Number(LAMPORTS_PER_SOL);
}

/** Seats filled / capacity, clamped to [0, 1]. */
export function fillRate(seatsFilled: number, capacity: number): number {
  if (capacity <= 0) throw new Error("capacity must be > 0");
  return Math.min(1, Math.max(0, seatsFilled / capacity));
}

/** Tokens to burn from the owner's bag at settlement. */
export function burnAmount(ownerTokens: bigint, fill: number, burnShareAtFullHouse: number): bigint {
  const bps = BigInt(Math.floor(fill * burnShareAtFullHouse * 10_000));
  return (ownerTokens * bps) / 10_000n;
}

export function isStale(updatedAtSec: number, maxAgeSec: number, nowSec = Date.now() / 1000): boolean {
  return nowSec - updatedAtSec > maxAgeSec;
}

export interface Window {
  launchedAt: number; // unix sec
  windowHours: number;
}

export function windowEndsAt(w: Window): number {
  return w.launchedAt + Math.round(w.windowHours * 3600);
}

export function windowOpen(w: Window, nowSec = Date.now() / 1000): boolean {
  return nowSec < windowEndsAt(w);
}
