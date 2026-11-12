import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  type FeeConfig,
  type Global,
} from "@pump-fun/pump-sdk";
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
  lookupTable?: string;
}

export const MAX_TX_BYTES = 1232;

export interface BuildLaunchParams {
  global: Global;
  feeConfig: FeeConfig | null;
  owner: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  /** Max SOL the owner may spend: the USD seed plus `slippageBps` headroom (see usdToLamports). */
  lamports: bigint;
  slippageBps: number;
}

/**
 * Build the create_v2 + first-buy instructions. Pure: no network.
 *
 * pump.fun's buy takes an exact token amount and a max SOL cost. The token amount is quoted for
 * the seed itself (lamports minus the headroom); the headroom only raises the max SOL, so the
 * owner gets the full $-seed worth of tokens and the tx still clears if fees differ slightly.
 */
export async function buildLaunchIxs(p: BuildLaunchParams) {
  const solAmount = new BN(p.lamports.toString());
  const seed = (p.lamports * 10_000n) / BigInt(10_000 + p.slippageBps);
  const quoted = getBuyTokenAmountFromSolAmount({
    global: p.global,
    feeConfig: p.feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount: new BN(seed.toString()),
    quoteMint: NATIVE_MINT,
  });
  const tokens = quoted;

  const pumpIxs = await PUMP_SDK.createV2AndBuyInstructions({
    global: p.global,
    mint: p.mint,
    name: p.name,
    symbol: p.symbol,
    uri: p.uri,
    creator: p.owner,
    user: p.owner,
    amount: tokens,
    solAmount,
    mayhemMode: false,
  });
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
    ...pumpIxs,
  ];
  return { ixs, quoted: BigInt(tokens.toString()), seedLamports: seed };
}

/** Compile + sign. Returns the tx and its wire size (Solana rejects > 1232 bytes). */
export function compileLaunchTx(
  ixs: TransactionInstruction[],
  owner: Keypair,
  mint: Keypair,
  blockhash: string,
  lookupTables: AddressLookupTableAccount[] = [],
) {
  const msg = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lookupTables);
  const tx = new VersionedTransaction(msg);
  tx.sign([owner, mint]);
  return { tx, bytes: tx.serialize().length };
}

/** Compile without signing (for simulateTransaction with sigVerify: false). */
export function compileUnsigned(ixs: TransactionInstruction[], payer: PublicKey, blockhash: string, lookupTables: AddressLookupTableAccount[] = []) {
  const tx = new VersionedTransaction(
    new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lookupTables),
  );
  return { tx, bytes: tx.serialize().length };
}

/** Every non-signer account in the launch, deduped: what goes into the lookup table. */
export function lookupTableAddresses(ixs: TransactionInstruction[], signers: PublicKey[]): PublicKey[] {
  const skip = new Set(signers.map((k) => k.toBase58()));
  const seen = new Map<string, PublicKey>();
  for (const ix of ixs) {
    for (const k of [ix.programId, ...ix.keys.filter((m) => !m.isSigner).map((m) => m.pubkey)]) {
      const b = k.toBase58();
      if (!skip.has(b)) seen.set(b, k);
    }
  }
  return [...seen.values()];
}

/** Create + fill a lookup table in one tx, wait until it's usable, return it. */
async function createLookupTable(conn: Connection, owner: Keypair, addresses: PublicKey[]): Promise<AddressLookupTableAccount> {
  const slot = await conn.getSlot("finalized");
  const [createIx, table] = AddressLookupTableProgram.createLookupTable({ authority: owner.publicKey, payer: owner.publicKey, recentSlot: slot });
  const extendIx = AddressLookupTableProgram.extendLookupTable({ authority: owner.publicKey, payer: owner.publicKey, lookupTable: table, addresses });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions: [createIx, extendIx] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([owner]);
  const sig = await conn.sendTransaction(tx, { maxRetries: 3 });
  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) throw new Error(`lookup table tx ${sig} failed: ${JSON.stringify(conf.value.err)}`);

  // A table's new entries are usable from the slot after the extend lands.
  const landed = await conn.getSlot("confirmed");
  for (let i = 0; i < 40; i++) {
    const acct = (await conn.getAddressLookupTable(table)).value;
    if (acct && acct.state.addresses.length === addresses.length && (await conn.getSlot("confirmed")) > landed) return acct;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`lookup table ${table.toBase58()} not active after 20s`);
}

/**
 * Create the coin on pump.fun and make the owner's first buy in one transaction.
 * The owner is both `creator` (receives creator fees) and `user` (pays the buy).
 * If the tx would exceed 1232 bytes (long metadata URI), a lookup table is created first
 * so create + buy still land atomically.
 */
export async function launchOnPump(p: LaunchParams): Promise<LaunchResult> {
  const online = new OnlinePumpSdk(p.conn);
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
  const mint = Keypair.generate();
  const { ixs, quoted } = await buildLaunchIxs({ ...p, owner: p.owner.publicKey, global, feeConfig, mint: mint.publicKey });

  let { blockhash, lastValidBlockHeight } = await p.conn.getLatestBlockhash("confirmed");
  let { tx, bytes } = compileLaunchTx(ixs, p.owner, mint, blockhash);
  let lookupTable: string | undefined;
  if (bytes > MAX_TX_BYTES) {
    const addrs = lookupTableAddresses(ixs, [p.owner.publicKey, mint.publicKey]);
    if (p.dryRun) {
      throw new Error(`launch tx is ${bytes} bytes (> ${MAX_TX_BYTES}); a real launch would first create a ${addrs.length}-address lookup table. Dry run stops here so it doesn't spend rent.`);
    }
    const table = await createLookupTable(p.conn, p.owner, addrs);
    lookupTable = table.key.toBase58();
    ({ blockhash, lastValidBlockHeight } = await p.conn.getLatestBlockhash("confirmed"));
    ({ tx, bytes } = compileLaunchTx(ixs, p.owner, mint, blockhash, [table]));
    if (bytes > MAX_TX_BYTES) throw new Error(`launch tx still ${bytes} bytes with lookup table`);
  }

  if (p.dryRun) {
    const sim = await p.conn.simulateTransaction(tx, { sigVerify: false });
    if (sim.value.err) {
      throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}\n${(sim.value.logs ?? []).join("\n")}`);
    }
    return { mint: mint.publicKey.toBase58(), signature: null, expectedTokens: quoted, simulatedLogs: sim.value.logs ?? [] };
  }

  const signature = await p.conn.sendTransaction(tx, { maxRetries: 3 });
  const conf = await p.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (conf.value.err) throw new Error(`launch tx ${signature} failed: ${JSON.stringify(conf.value.err)}`);
  return { mint: mint.publicKey.toBase58(), signature, expectedTokens: quoted, lookupTable };
}

export function pumpUrl(mint: string | PublicKey): string {
  return `https://pump.fun/coin/${mint.toString()}`;
}
