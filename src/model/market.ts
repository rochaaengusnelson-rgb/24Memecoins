/**
 * Agent-based market on a pump.fun curve: many micro traders, a few whales, an optional
 * attendance peg keeper, and the owner. One run = one seeded random path, minute by minute.
 * All trades go through Curve (pump.fun constant-product math + live fee rates).
 */
import { Curve, seatsAt } from "./curve.js";

// ---------- RNG ----------
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    normal: () => {
      const u = Math.max(next(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    poisson: (lambda: number) => {
      if (lambda <= 0) return 0;
      if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12))) * Math.cos(2 * Math.PI * next())));
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
  };
}
type Rng = ReturnType<typeof rng>;

// ---------- parameters ----------
export interface MicroParams {
  wallets: number; // distinct small traders (fans in the building + online)
  baseRatePerMin: number; // trades/min with an empty venue while the event is on
  peakRatePerMin: number; // extra trades/min at a full house
  medianUsd: number; // median buy size
  sizeSigma: number; // lognormal sigma of buy size
  minUsd: number;
  maxUsd: number;
  inflowWeight: number; // how strongly seat inflow drives buy/sell bias
  pegWeight: number; // how strongly price vs attendance value drives buy/sell bias
  takeProfit: number; // a seller up this much sells everything; otherwise half
}

export type WhaleStrategy = "doors-sniper" | "momentum" | "front-runner" | "late-fomo";
export interface WhaleParams {
  id: string;
  name: string;
  strategy: WhaleStrategy;
  budgetUsd: number;
}

export interface PegKeeperParams {
  inventoryUsd: number; // tokens bought at launch so it can sell into rallies (counts toward budget)
  bandPct: number; // trade when price is more than this far from the attendance value
  maxUsdPerMin: number;
  budgetUsd: number;
}

export interface OwnerPlan {
  kind: "hold-burn" | "sell";
  sellMinute?: number;
}

export interface MarketParams {
  solUsd: number;
  supply: number; // token base units
  capacity: number;
  points: Array<[number, number]>; // attendance profile, minutes after launch
  showStart: number;
  showEnd: number;
  windowMin: number;
  perSeatUsd: number;
  ownerSeedLamports: bigint;
  burnShareAtFullHouse: number;
  micro: MicroParams;
  whales: WhaleParams[];
  pegKeeper?: PegKeeperParams;
  owner: OwnerPlan;
  keepPathEvery?: number; // record a path point every N minutes (default 5)
}

export const DEFAULT_MICRO: MicroParams = {
  wallets: 2000,
  baseRatePerMin: 0.4,
  peakRatePerMin: 9,
  medianUsd: 25,
  sizeSigma: 0.9,
  minUsd: 2,
  maxUsd: 500,
  inflowWeight: 0.35,
  pegWeight: 0.25,
  takeProfit: 0.3,
};

export const DEFAULT_WHALES: WhaleParams[] = [
  { id: "W1", name: "Doors sniper: buys at 7:00 PM, sells half at showtime and the rest mid-show", strategy: "doors-sniper", budgetUsd: 2500 },
  { id: "W2", name: "Momentum: buys when arrivals surge, sells when the crowd starts leaving", strategy: "momentum", budgetUsd: 1500 },
  { id: "W3", name: "Front-runner: buys at full house, sells just before the headliner ends", strategy: "front-runner", budgetUsd: 2000 },
  { id: "W4", name: "Late FOMO: buys late in the show, panic-sells after a 30% drop", strategy: "late-fomo", budgetUsd: 3000 },
];

// ---------- results ----------
export interface Wallet {
  tokens: bigint;
  solIn: bigint; // gross SOL spent
  solOut: bigint; // net SOL received
}
export interface TradeMark {
  who: string;
  side: "buy" | "sell";
  minute: number;
  usd: number;
}
export interface RunResult {
  path: Array<{ m: number; mcap: number; peg: number; seats: number }>;
  marks: TradeMark[];
  owner: { cost: bigint; tokens0: bigint; proceeds: bigint; burned: bigint; tokensLeft: bigint; markValue: bigint; creatorFees: bigint };
  whales: Array<{ id: string; solIn: bigint; solOut: bigint; markValue: bigint }>;
  micro: { solIn: bigint; solOut: bigint; markValue: bigint; walletsTraded: number; walletsProfitable: number; trades: number };
  keeper?: { solIn: bigint; solOut: bigint; markValue: bigint };
  peakMcap: number;
  closeMcap: number;
  launchMcap: number;
  trackingErr: number; // mean |mcap/peg - 1| from launch to venue empty
  graduated: boolean;
}

// ---------- simulation ----------
export function simulate(curve: Curve, p: MarketParams, seed: number): RunResult {
  const R: Rng = rng(seed);
  const lamportsPerUsd = 1e9 / p.solUsd;
  const usdToLamports = (usd: number) => BigInt(Math.round(usd * lamportsPerUsd));
  const mcapOf = () => (curve.price() * p.supply * p.solUsd) / 1e9;
  const markValue = (tokens: bigint) => {
    if (tokens <= 0n) return 0n;
    const fee = Number(curve.totalFeeBps) / 10_000;
    return BigInt(Math.round(Number(tokens) * curve.price() * (1 - fee)));
  };

  // owner seed at launch
  const owner = { tokens: curve.buyGross(p.ownerSeedLamports).tokens, proceeds: 0n };
  const ownerTokens0 = owner.tokens;
  curve.creatorFees = 0n;
  const launchMcap = mcapOf();
  const peg = (seats: number) => launchMcap + p.perSeatUsd * seats;
  const peakSeats = Math.max(...p.points.map((x) => x[1]));
  const emptyAt = p.points[p.points.length - 1][0];

  const micro: Wallet[] = Array.from({ length: p.micro.wallets }, () => ({ tokens: 0n, solIn: 0n, solOut: 0n }));
  const holders = new Set<number>();
  let microTrades = 0;
  const whales = p.whales.map((w) => ({ ...w, wallet: { tokens: 0n, solIn: 0n, solOut: 0n } as Wallet, state: {} as Record<string, number> }));
  const keeper = p.pegKeeper ? { cfg: p.pegKeeper, wallet: { tokens: 0n, solIn: 0n, solOut: 0n } as Wallet } : undefined;
  const marks: TradeMark[] = [];
  const path: RunResult["path"] = [{ m: 0, mcap: launchMcap, peg: launchMcap, seats: 0 }];
  let graduated = false;
  let errSum = 0;
  let errN = 0;
  let peakMcap = launchMcap;

  const buy = (w: Wallet, lamports: bigint): bigint => {
    if (lamports <= 0n || graduated) return 0n;
    try {
      const t = curve.buyGross(lamports);
      w.tokens += t.tokens;
      w.solIn += t.solGross;
      return t.tokens;
    } catch {
      graduated = true; // curve full: pump.fun migrates it to PumpSwap; we stop trading there
      return 0n;
    }
  };
  const sell = (w: Wallet, tokens: bigint): bigint => {
    if (graduated) return 0n; // migrated to PumpSwap: trading there isn't modeled
    const amt = tokens > w.tokens ? w.tokens : tokens;
    if (amt <= 0n) return 0n;
    const t = curve.sell(amt);
    w.tokens -= amt;
    w.solOut += t.solNet;
    return t.solNet;
  };
  const jitter = (base: number, spread: number) => Math.round(base + R.range(-spread, spread));

  // whale schedules (randomized per run)
  for (const w of whales) {
    const s = w.state;
    const budget = w.budgetUsd * R.range(0.75, 1.25);
    s.budgetUsd = budget;
    if (w.strategy === "doors-sniper") {
      s.buyAt = R.int(1, 5);
      s.sellHalfAt = jitter(p.showStart, 10);
      s.sellRestAt = jitter((p.showStart + p.showEnd) / 2, 15);
    } else if (w.strategy === "front-runner") {
      s.buyAt = jitter(p.showStart + 30, 10);
      s.sellAt = p.showEnd - R.int(3, 12);
    } else if (w.strategy === "late-fomo") {
      s.buyAt = jitter(p.showEnd - 75, 20);
    }
  }

  for (let m = 1; m <= p.windowMin; m++) {
    const seats = seatsAt(p.points, m);
    const inflow = seats - seatsAt(p.points, m - 5); // seats per 5 minutes
    const pegNow = peg(seats);

    // --- owner ---
    if (p.owner.kind === "sell" && p.owner.sellMinute === m && owner.tokens > 0n && !graduated) {
      const t = curve.sell(owner.tokens);
      owner.tokens = 0n;
      owner.proceeds += t.solNet;
      marks.push({ who: "Owner", side: "sell", minute: m, usd: Number(t.solNet) / lamportsPerUsd });
    }

    // --- whales ---
    for (const w of whales) {
      const s = w.state;
      const W = w.wallet;
      const usdNow = (tokens: bigint) => (Number(tokens) * curve.price()) / lamportsPerUsd;
      if (w.strategy === "doors-sniper") {
        if (m === s.buyAt) { buy(W, usdToLamports(s.budgetUsd)); marks.push({ who: w.id, side: "buy", minute: m, usd: s.budgetUsd }); }
        if (m === s.sellHalfAt && W.tokens > 0n) { const o = sell(W, W.tokens / 2n); marks.push({ who: w.id, side: "sell", minute: m, usd: Number(o) / lamportsPerUsd }); }
        if (m === s.sellRestAt && W.tokens > 0n) { const o = sell(W, W.tokens); marks.push({ who: w.id, side: "sell", minute: m, usd: Number(o) / lamportsPerUsd }); }
      } else if (w.strategy === "momentum") {
        if (!s.bought && m < p.showStart && inflow > 800 * R.range(0.85, 1.15)) { buy(W, usdToLamports(s.budgetUsd)); s.bought = 1; marks.push({ who: w.id, side: "buy", minute: m, usd: s.budgetUsd }); }
        if (s.bought && !s.sold && m > p.showStart && inflow < -50 && W.tokens > 0n) { const o = sell(W, W.tokens); s.sold = 1; marks.push({ who: w.id, side: "sell", minute: m, usd: Number(o) / lamportsPerUsd }); }
      } else if (w.strategy === "front-runner") {
        if (m === s.buyAt) { buy(W, usdToLamports(s.budgetUsd)); marks.push({ who: w.id, side: "buy", minute: m, usd: s.budgetUsd }); }
        if (m === s.sellAt && W.tokens > 0n) { const o = sell(W, W.tokens); marks.push({ who: w.id, side: "sell", minute: m, usd: Number(o) / lamportsPerUsd }); }
      } else if (w.strategy === "late-fomo") {
        if (m === s.buyAt) { buy(W, usdToLamports(s.budgetUsd)); s.entry = mcapOf(); marks.push({ who: w.id, side: "buy", minute: m, usd: s.budgetUsd }); }
        if (s.entry && W.tokens > 0n && mcapOf() < s.entry * 0.7) { const o = sell(W, W.tokens); s.entry = 0; marks.push({ who: w.id, side: "sell", minute: m, usd: Number(o) / lamportsPerUsd }); }
      }
      void usdNow;
    }

    // --- micro traders ---
    const eventOn = m <= emptyAt + 30;
    const lambda = eventOn
      ? p.micro.baseRatePerMin + p.micro.peakRatePerMin * (seats / peakSeats) + (inflow < -200 ? p.micro.peakRatePerMin * 0.6 : 0)
      : p.micro.baseRatePerMin * 0.25;
    const n = R.poisson(lambda);
    const gap = mcapOf() / pegNow - 1;
    const pBuy = Math.min(0.92, Math.max(0.08, 0.5 + p.micro.inflowWeight * Math.tanh(inflow / 1200) - p.micro.pegWeight * Math.tanh(gap * 3) - (eventOn ? 0 : 0.15)));
    for (let i = 0; i < n; i++) {
      microTrades++;
      if (R.next() < pBuy || holders.size === 0) {
        const usd = Math.min(p.micro.maxUsd, Math.max(p.micro.minUsd, p.micro.medianUsd * Math.exp(p.micro.sizeSigma * R.normal())));
        const idx = R.int(0, micro.length - 1);
        if (buy(micro[idx], usdToLamports(usd)) > 0n) holders.add(idx);
      } else {
        const list = [...holders];
        const idx = list[R.int(0, list.length - 1)];
        const w = micro[idx];
        const cost = Number(w.solIn - w.solOut);
        const value = Number(markValue(w.tokens));
        const inProfit = cost <= 0 || value / cost - 1 > p.micro.takeProfit;
        sell(w, inProfit || !eventOn || inflow < -200 ? w.tokens : w.tokens / 2n);
        if (w.tokens === 0n) holders.delete(idx);
      }
    }

    // --- peg keeper (market maker trading toward the attendance value) ---
    if (keeper && m === 1 && keeper.cfg.inventoryUsd > 0) buy(keeper.wallet, usdToLamports(keeper.cfg.inventoryUsd));
    if (keeper && m > 1 && m <= emptyAt) {
      const k = keeper.cfg;
      const mc = mcapOf();
      const spent = Number(keeper.wallet.solIn - keeper.wallet.solOut) / lamportsPerUsd;
      if (mc < pegNow * (1 - k.bandPct) && spent < k.budgetUsd) {
        const target = curve.vSForPrice((pegNow * 1e9) / (p.supply * p.solUsd));
        const need = (Number(target - curve.vS) * (1 + Number(curve.totalFeeBps) / 10_000)) / lamportsPerUsd;
        const usd = Math.min(need, k.maxUsdPerMin, k.budgetUsd - spent);
        if (usd > 1) buy(keeper.wallet, usdToLamports(usd));
      } else if (mc > pegNow * (1 + k.bandPct) && keeper.wallet.tokens > 0n) {
        const target = curve.vSForPrice((pegNow * 1e9) / (p.supply * p.solUsd));
        const needTokens = (curve.k + target - 1n) / target - curve.vT;
        const capTokens = BigInt(Math.round((k.maxUsdPerMin * lamportsPerUsd) / curve.price()));
        let amt = needTokens < capTokens ? needTokens : capTokens;
        if (amt > keeper.wallet.tokens) amt = keeper.wallet.tokens;
        if (amt > 0n) sell(keeper.wallet, amt);
      }
    }

    const mc = mcapOf();
    peakMcap = Math.max(peakMcap, mc);
    if (m <= emptyAt) {
      errSum += Math.abs(mc / pegNow - 1);
      errN++;
    }
    if (m % (p.keepPathEvery ?? 5) === 0) path.push({ m, mcap: mc, peg: pegNow, seats: Math.round(seats) });
  }

  // settlement
  let burned = 0n;
  if (p.owner.kind === "hold-burn" && owner.tokens > 0n) {
    const bps = BigInt(Math.floor(Math.min(1, peakSeats / p.capacity) * p.burnShareAtFullHouse * 10_000));
    burned = (owner.tokens * bps) / 10_000n;
    owner.tokens -= burned;
  }

  // Leftover tokens: value them together at what selling ALL of them into the curve returns,
  // split pro rata. This conserves SOL (no paper gains the curve couldn't pay out).
  const leftover =
    owner.tokens +
    micro.reduce((a, w) => a + w.tokens, 0n) +
    whales.reduce((a, w) => a + w.wallet.tokens, 0n) +
    (keeper ? keeper.wallet.tokens : 0n);
  const liquidation = leftover > 0n ? curve.quoteSell(leftover) : 0n;
  const liqValue = (tokens: bigint) => (leftover > 0n ? (liquidation * tokens) / leftover : 0n);

  const microAgg = micro.reduce(
    (a, w) => {
      if (w.solIn === 0n) return a;
      const v = liqValue(w.tokens);
      a.solIn += w.solIn;
      a.solOut += w.solOut;
      a.markValue += v;
      a.walletsTraded++;
      if (w.solOut + v > w.solIn) a.walletsProfitable++;
      return a;
    },
    { solIn: 0n, solOut: 0n, markValue: 0n, walletsTraded: 0, walletsProfitable: 0, trades: microTrades },
  );

  return {
    path,
    marks,
    owner: { cost: p.ownerSeedLamports, tokens0: ownerTokens0, proceeds: owner.proceeds, burned, tokensLeft: owner.tokens, markValue: liqValue(owner.tokens), creatorFees: curve.creatorFees },
    whales: whales.map((w) => ({ id: w.id, solIn: w.wallet.solIn, solOut: w.wallet.solOut, markValue: liqValue(w.wallet.tokens) })),
    micro: microAgg,
    keeper: keeper ? { solIn: keeper.wallet.solIn, solOut: keeper.wallet.solOut, markValue: liqValue(keeper.wallet.tokens) } : undefined,
    peakMcap,
    closeMcap: mcapOf(),
    launchMcap,
    trackingErr: errN ? errSum / errN : 0,
    graduated,
  };
}
