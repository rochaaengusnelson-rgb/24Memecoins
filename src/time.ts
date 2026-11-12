/** Wall-clock label in New York time, `minute` minutes after `startIso` (e.g. "Fri 9:00 PM"). */
export function etClock(startIso: string, minute: number): string {
  return new Date(Date.parse(startIso) + minute * 60_000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
