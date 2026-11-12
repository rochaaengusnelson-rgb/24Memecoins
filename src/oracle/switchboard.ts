import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorUtils, PullFeed } from "@switchboard-xyz/on-demand";
import { isStale } from "../math.js";

export interface FeedReading {
  feed: string;
  name: string;
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

/** Load the latest value a Switchboard On-Demand pull feed stored on chain (18-decimal fixed point). No freshness check. */
export async function loadFeed(conn: Connection, feed: string): Promise<FeedReading> {
  const pf = new PullFeed(await program(conn), new PublicKey(feed));
  const data = await pf.loadData();
  const raw = BigInt(data.result.value.toString());
  return {
    feed,
    name: Buffer.from(data.name).toString("utf8").split(String.fromCharCode(0)).join("").trim(),
    value: Number(raw) / 1e18,
    updatedAt: Number(data.lastUpdateTimestamp.toString()),
    slot: Number(data.result.slot.toString()),
  };
}

export function feedAgeSec(r: FeedReading, nowSec = Date.now() / 1000): number {
  return Math.round(nowSec - r.updatedAt);
}

/**
 * Read a feed and refuse to return a value older than `maxAgeSec`.
 * Pull feeds are only as fresh as their last update: a crank (or the launcher) has to post updates.
 */
export async function readFeed(conn: Connection, feed: string, maxAgeSec: number): Promise<FeedReading> {
  const reading = await loadFeed(conn, feed);
  if (reading.updatedAt === 0) throw new Error(`Switchboard feed ${feed} has never been updated`);
  if (isStale(reading.updatedAt, maxAgeSec)) {
    throw new Error(`Switchboard feed ${feed} is stale: ${feedAgeSec(reading)}s old (max ${maxAgeSec}s). Crank an update first.`);
  }
  return reading;
}

export function isPubkey(s: string): boolean {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}
