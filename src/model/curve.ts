/**
 * pump.fun bonding curve: constant product on virtual reserves (k = vS * vT).
 * Fees are charged on top of buys and taken out of sells; they leave the curve, so k is unchanged.
 * Price (lamports per base unit) = vS / vT.
 */

export interface FeeBps {
  protocol: bigint;
  creator: bigint;
}

export interface CurveInit {
  vS: bigint; // initial virtual SOL (lamports)
  vT: bigint; // initial virtual tokens (base units)
  realT: bigint; // initial real tokens on the curve
}

export interface Trade {
  side: "buy" | "sell";
  solGross: bigint; // buy: what the buyer pays incl. fees. sell: SOL before fees
  solNet: bigint; // buy: SOL into the curve. sell: what the seller receives
  tokens: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
}

const BPS = 10_000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export class Curve {
  vS: bigint;
  vT: bigint;
  readonly k: bigint;
  readonly init: CurveInit;
  readonly fees: FeeBps;
  creatorFees = 0n;
  protocolFees = 0n;
  volume = 0n;

  constructor(init: CurveInit, fees: FeeBps) {
    this.init = init;
    this.vS = init.vS;
    this.vT = init.vT;
    this.k = init.vS * init.vT;
    this.fees = fees;
  }

  get totalFeeBps(): bigint {
    return this.fees.protocol + this.fees.creator;
  }
  /** SOL actually held by the curve. */
  get realSol(): bigint {
    return this.vS - this.init.vS;
  }
  /** Tokens still buyable before graduation. */
  get realTokensLeft(): bigint {
    return this.init.realT - (this.init.vT - this.vT);
  }
  /** Lamports per base unit. */
  price(): number {
    return Number(this.vS) / Number(this.vT);
  }

  private feeSplit(base: bigint) {
    const protocolFee = ceilDiv(base * this.fees.protocol, BPS);
    const creatorFee = ceilDiv(base * this.fees.creator, BPS);
    return { protocolFee, creatorFee };
  }

  /** Buy with `solNet` going into the curve; buyer pays net + fees. */
  buyNet(solNet: bigint): Trade {
    if (solNet <= 0n) throw new Error("buy amount must be > 0");
    const newVT = ceilDiv(this.k, this.vS + solNet);
    const tokens = this.vT - newVT;
    if (tokens > this.realTokensLeft) throw new Error("buy would exceed the curve (graduation)");
    const { protocolFee, creatorFee } = this.feeSplit(solNet);
    this.vS += solNet;
    this.vT = newVT;
    this.record(solNet, protocolFee, creatorFee);
    return { side: "buy", solGross: solNet + protocolFee + creatorFee, solNet, tokens, protocolFee, creatorFee };
  }

  /** Buy spending at most `solGross` including fees. */
  buyGross(solGross: bigint): Trade {
    return this.buyNet((solGross * BPS) / (BPS + this.totalFeeBps));
  }

  sell(tokens: bigint): Trade {
    if (tokens <= 0n) throw new Error("sell amount must be > 0");
    const newVS = ceilDiv(this.k, this.vT + tokens);
    const solGross = this.vS - newVS;
    const { protocolFee, creatorFee } = this.feeSplit(solGross);
    this.vS = newVS;
    this.vT += tokens;
    this.record(solGross, protocolFee, creatorFee);
    return { side: "sell", solGross, solNet: solGross - protocolFee - creatorFee, tokens, protocolFee, creatorFee };
  }

  /** What selling `tokens` would return right now, without trading. */
  quoteSell(tokens: bigint): bigint {
    const newVS = ceilDiv(this.k, this.vT + tokens);
    const gross = this.vS - newVS;
    const { protocolFee, creatorFee } = this.feeSplit(gross);
    return gross - protocolFee - creatorFee;
  }

  /** vS that gives `price` (lamports per base unit) on this curve. */
  vSForPrice(price: number): bigint {
    return BigInt(Math.round(Math.sqrt(price * Number(this.k))));
  }

  private record(base: bigint, protocolFee: bigint, creatorFee: bigint) {
    this.volume += base;
    this.protocolFees += protocolFee;
    this.creatorFees += creatorFee;
  }
}

/** Piecewise-linear interpolation of [minute, seats] points. */
export function seatsAt(points: Array<[number, number]>, minute: number): number {
  if (minute <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [m1, s1] = points[i];
    const [m0, s0] = points[i - 1];
    if (minute <= m1) return s0 + ((s1 - s0) * (minute - m0)) / (m1 - m0);
  }
  return points[points.length - 1][1];
}
