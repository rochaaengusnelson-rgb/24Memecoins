import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import BN from "bn.js";

export interface LaunchParams {
  conn: Connection;
  owner: Keypair;
  name: string;
  symbol: string;
  uri: string;
  /** SOL the owner spends on the first buy (the $500 seed), in lamports. */
  lamports: bigint;
  /** Slippage on the token amount for the first buy, bps. */
  slippageBps: number;
  dryRun?: boolean;
}

export interface LaunchResult {
  mint: string;
  signature: string | null;
  expectedTokens: bigint;
  simulatedLogs?: string[];
}

/**
 * Create the coin on pump.fun and make the owner's first buy in one transaction.
 * The owner is both `creator` (receives creator fees) and `user` (pays the buy).
 */
export async function launchOnPump(p: LaunchParams): Promise<LaunchResult> {
  const online = new OnlinePumpSdk(p.conn);
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
  const mint = Keypair.generate();
  const solAmount = new BN(p.lamports.toString());

  const quoted = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount: solAmount,
    quoteMint: NATIVE_MINT,
  });
  // Ask for slightly fewer tokens than quoted so the buy still clears if fees move.
  const minTokens = quoted.muln(10_000 - p.slippageBps).divn(10_000);

  const ixs = await PUMP_SDK.createV2AndBuyInstructions({
    global,
    mint: mint.publicKey,
    name: p.name,
    symbol: p.symbol,
    uri: p.uri,
    creator: p.owner.publicKey,
    user: p.owner.publicKey,
    amount: minTokens,
    solAmount,
    mayhemMode: false,
  });

  const { blockhash, lastValidBlockHeight } = await p.conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: p.owner.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
      ...ixs,
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([p.owner, mint]);

  if (p.dryRun) {
    const sim = await p.conn.simulateTransaction(tx, { sigVerify: false });
    if (sim.value.err) {
      throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).join("\n")}`);
    }
    return { mint: mint.publicKey.toBase58(), signature: null, expectedTokens: BigInt(quoted.toString()), simulatedLogs: sim.value.logs ?? [] };
  }

  const signature = await p.conn.sendTransaction(tx, { maxRetries: 3 });
  const conf = await p.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) throw new Error(`launch tx ${signature} failed: ${JSON.stringify(conf.value.err)}`);
  return { mint: mint.publicKey.toBase58(), signature, expectedTokens: BigInt(quoted.toString()) };
}

export function pumpUrl(mint: string | PublicKey): string {
  return `https://pump.fun/coin/${mint.toString()}`;
}
