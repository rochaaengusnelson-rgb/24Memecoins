import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";

/** The owner's token balance for `mint`, plus the token program that owns the mint (pump create_v2 coins are Token-2022). */
export async function ownerBag(conn: Connection, owner: PublicKey, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
  const programId = info.owner;
  const mintInfo = await getMint(conn, mint, "confirmed", programId);
  const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
  const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
  return { programId, decimals: mintInfo.decimals, ata, amount: BigInt(bal?.value.amount ?? "0") };
}

export async function burnFromOwner(conn: Connection, owner: Keypair, mint: PublicKey, amount: bigint): Promise<string | null> {
  if (amount === 0n) return null;
  const bag = await ownerBag(conn, owner.publicKey, mint);
  const ix = createBurnCheckedInstruction(bag.ata, mint, owner.publicKey, amount, bag.decimals, [], bag.programId);
  return sendAndConfirmTransaction(conn, new Transaction().add(ix), [owner], { commitment: "confirmed" });
}
