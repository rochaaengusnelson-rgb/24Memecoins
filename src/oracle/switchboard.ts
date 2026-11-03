import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorUtils, PullFeed } from "@switchboard-xyz/on-demand";
import { isStale } from "../math.js";

export interface FeedReading {
  feed: string;
  value: number;
  /** Unix seconds of the last oracle update stored on chain. */
  updatedAt: number;
  slot: number;
}

type SbProgram = Awaited<ReturnType<typeof AnchorUtils.loadProgramFromConnection>>;
let cached: { conn: Connection; program: SbProgram } | undefined;

async function program(conn: Connection): Promise<SbProgram> {
  if (!cached || cached.conn !== conn) {
    cached = { conn, program: await AnchorUtils.loadProgramFromConnection(conn) };
  }
  return cached.program;
}

/**
 * Read the latest value a Switchboard On-Demand pull feed has stored on chain.
 * Values are stored as 18-decimal fixed point.
 *
 * Pull feeds are only as fresh as their last update. Someone (a crank, or the launcher
 * itself) has to post updates. `maxAgeSec` makes sure we never act on an old value.
 */
export async function readFeed(conn: Connection, feed: string, maxAgeSec: number): Promise<FeedReading> {
  const pf = new PullFeed(await program(conn), new PublicKey(feed));
  const data = await pf.loadData();
  const raw = BigInt(data.result.value.toString());
  const value = Number(raw) / 1e18;
  const updatedAt = Number(data.lastUpdateTimestamp.toString());
  const reading = { feed, value, updatedAt, slot: Number(data.result.slot.toString()) };
  if (updatedAt === 0) throw new Error(`Switchboard feed ${feed} has never been updated`);
  if (isStale(updatedAt, maxAgeSec)) {
    const age = Math.round(Date.now() / 1000 - updatedAt);
    throw new Error(`Switchboard feed ${feed} is stale: ${age}s old (max ${maxAgeSec}s). Crank an update first.`);
  }
  return reading;
}
