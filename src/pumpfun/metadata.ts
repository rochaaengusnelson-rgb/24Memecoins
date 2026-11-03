import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { EventConfig } from "../event.js";

const PUMP_IPFS = "https://pump.fun/api/ipfs";

/** Upload the coin image + metadata to pump.fun's IPFS endpoint and return the metadata URI. */
export async function uploadMetadata(ev: EventConfig): Promise<string> {
  const form = new FormData();
  const img = readFileSync(ev.coin.image);
  form.append("file", new Blob([img]), basename(ev.coin.image));
  form.append("name", ev.coin.name);
  form.append("symbol", ev.coin.symbol);
  form.append("description", ev.description);
  form.append("showName", "true");
  if (ev.coin.twitter) form.append("twitter", ev.coin.twitter);
  if (ev.coin.telegram) form.append("telegram", ev.coin.telegram);
  if (ev.coin.website) form.append("website", ev.coin.website);

  const res = await fetch(PUMP_IPFS, { method: "POST", body: form });
  if (!res.ok) throw new Error(`pump.fun IPFS upload failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { metadataUri?: string };
  if (!json.metadataUri) throw new Error(`pump.fun IPFS response had no metadataUri: ${JSON.stringify(json)}`);
  return json.metadataUri;
}
