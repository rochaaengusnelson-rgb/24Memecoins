import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LaunchState {
  eventId: string;
  mint: string;
  signature: string;
  owner: string;
  launchedAt: number;
  windowHours: number;
  fundedLamports: string;
  solUsdAtLaunch: number;
  seatsAtLaunch: number;
  metadataUri: string;
  settlement?: {
    settledAt: number;
    seatsFilled: number;
    capacity: number;
    fillRate: number;
    burned: string;
    signature: string | null;
  };
}

const DIR = "state";
const file = (eventId: string) => join(DIR, `${eventId}.json`);

export function loadState(eventId: string): LaunchState | null {
  return existsSync(file(eventId)) ? (JSON.parse(readFileSync(file(eventId), "utf8")) as LaunchState) : null;
}

export function saveState(s: LaunchState): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file(s.eventId), JSON.stringify(s, null, 2) + "\n");
}
