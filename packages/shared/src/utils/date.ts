/**
 * All timestamps are stored and transported in UTC (Doc 02 §7).
 * Conversion to the user's time zone happens only in the presentation layer.
 */

/** Current time as epoch milliseconds (UTC). */
export function nowUtcMs(): number {
  return Date.now();
}

/** ISO-8601 UTC string, e.g. `2026-11-10T08:30:00.000Z`. */
export function toIsoUtc(value: Date | number): string {
  return new Date(value).toISOString();
}

function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(epochMs);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** The instant a calendar day (`YYYY-MM-DD`) starts in a time zone (00:00 local). */
export function zonedDayStart(isoDate: string, timeZone: string): number {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/** The calendar day (`YYYY-MM-DD`) an instant falls on in a time zone. */
export function zonedIsoDate(epochMs: number, timeZone: string): string {
  return new Date(epochMs + zoneOffsetMs(epochMs, timeZone)).toISOString().slice(0, 10);
}

/** The day after a calendar day (`YYYY-MM-DD`). */
export function nextIsoDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
