/** Local wall-clock helpers. Intl is used so DST shifts never move the windows. */

function localMinutes(nowMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

/** Wraps midnight, hence OR rather than a range test. */
function inWindow(nowMs: number, timeZone: string, startMin: number, endMin: number): boolean {
  const m = localMinutes(nowMs, timeZone);
  return m >= startMin || m < endMin;
}

/** Inbound soft register: 23:00–05:00 local (persona.py NIGHT_START/END). */
export function isNight(nowMs: number, timeZone: string): boolean {
  return inWindow(nowMs, timeZone, 23 * 60, 5 * 60);
}

/** Outbound quiet hours: 23:00–06:30 local (n8n "Quiet Hours Gate"). */
export function isQuietHours(nowMs: number, timeZone: string): boolean {
  return inWindow(nowMs, timeZone, 23 * 60, 6 * 60 + 30);
}
