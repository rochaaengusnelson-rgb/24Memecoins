import { Connection } from "@solana/web3.js";
import { OnlinePumpSdk, computeFeesBps, type FeeConfig, type Global } from "@pump-fun/pump-sdk";
import { Curve } from "./curve.js";

/** Live pump.fun Global + FeeConfig from mainnet. */
export async function livePumpParams(): Promise<{ global: Global; feeConfig: FeeConfig | null; source: string }> {
  const url = process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const sdk = new OnlinePumpSdk(new Connection(url, "confirmed"));
  const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
  return { global, feeConfig, source: `live mainnet (${new Date().toISOString()})` };
}

export function feesFor(g: Global, fc: FeeConfig | null) {
  const f = computeFeesBps({
    global: g,
    feeConfig: fc,
    mintSupply: g.tokenTotalSupply,
    virtualQuoteReserves: g.initialVirtualSolReserves,
    virtualTokenReserves: g.initialVirtualTokenReserves,
  });
  return { protocol: BigInt(f.protocolFeeBps.toString()), creator: BigInt(f.creatorFeeBps.toString()) };
}

/** A fresh pump.fun curve with the live parameters. */
export function freshCurve(g: Global, fc: FeeConfig | null): Curve {
  return new Curve(
    {
      vS: BigInt(g.initialVirtualSolReserves.toString()),
      vT: BigInt(g.initialVirtualTokenReserves.toString()),
      realT: BigInt(g.initialRealTokenReserves.toString()),
    },
    feesFor(g, fc),
  );
}
