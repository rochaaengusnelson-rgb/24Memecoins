import { readFileSync } from "node:fs";
import { z } from "zod";

const Venue = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  /** How many screens/rooms this entry covers (e.g. 35 theaters rolled into one line). */
  locations: z.number().int().positive().default(1),
  seats: z.number().int().positive(),
});

export const EventConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
  artist: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  /** ISO timestamp the broadcast starts; the coin's 24h window starts at launch. */
  startsAt: z.iso.datetime({ offset: true }),
  /** ISO timestamp the show ends (headliner off stage). Optional; shown in timelines. */
  endsAt: z.iso.datetime({ offset: true }).optional(),
  coin: z.object({
    name: z.string().min(1).max(32),
    symbol: z.string().min(1).max(10),
    image: z.string().min(1).describe("local file path to the coin image"),
    twitter: z.string().optional(),
    telegram: z.string().optional(),
    website: z.string().optional(),
  }),
  venues: z.array(Venue).min(1),
  funding: z.object({
    /** USD the event owner puts in as the first buy on the bonding curve. */
    usd: z.number().positive().default(500),
    /** Extra SOL headroom over the quoted amount to absorb price drift / fees (bps). */
    slippageBps: z.number().int().min(0).max(5000).default(300),
  }),
  oracle: z.object({
    /** Switchboard On-Demand pull feed that reports total seats filled across all venues. */
    attendanceFeed: z.string().min(32),
    /** Feed value must be newer than this when we act on it. */
    maxAgeSec: z.number().int().positive().default(600),
  }),
  rules: z.object({
    windowHours: z.number().positive().default(24),
    /** Don't launch until the attendance feed shows at least this many seats filled. */
    minSeatsToLaunch: z.number().int().min(0).default(0),
    /**
     * At settlement, burn this share of the owner's first-buy tokens multiplied by the fill rate.
     * 1.0 = a 100% full house burns 100% of the owner's bag; 60% full burns 60%.
     */
    burnShareAtFullHouse: z.number().min(0).max(1).default(1),
  }),
});

export type EventConfig = z.infer<typeof EventConfig>;

export function loadEvent(path: string): EventConfig {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return EventConfig.parse(raw);
}

export function totalCapacity(ev: Pick<EventConfig, "venues">): number {
  return ev.venues.reduce((sum, v) => sum + v.seats, 0);
}
