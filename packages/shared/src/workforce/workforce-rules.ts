/**
 * Workforce rules shared by the API and the web app (Sprint 7, D-49 / D-50).
 * Expiry state (PLT-20, T-50) and search normalisation (T-52).
 */

/** O-83: a record is "expiring" this many days (or fewer) before its expiry date. */
export const EXPIRY_WARNING_DAYS = 30;

/** O-83: reminders 30 days and 7 days before, and on the expiry day. */
export const EXPIRY_REMINDER_DAYS = [30, 7, 0] as const;

/** O-84: assignments ending within this many days are in the daily digest. */
export const ASSIGNMENT_ENDING_NOTICE_DAYS = 7;

export const EXPIRY_STATES = ['none', 'valid', 'expiring', 'expired'] as const;
export type ExpiryState = (typeof EXPIRY_STATES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `fromIso` to `toIso` (both `YYYY-MM-DD`); negative when `toIso` is earlier. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS,
  );
}

/** A calendar day plus `days` (may be negative). */
export function addIsoDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * T-50: the expiry state of a dated record. `today` is the calendar day in the company's time
 * zone. The expiry day itself counts as "expiring" (0 days left).
 */
export function expiryState(expiresOn: string | null | undefined, today: string): ExpiryState {
  if (!expiresOn) return 'none';
  const left = daysBetween(today, expiresOn);
  if (left < 0) return 'expired';
  if (left <= EXPIRY_WARNING_DAYS) return 'expiring';
  return 'valid';
}

/** The reminder threshold due for a record `daysLeft` from expiry, or null (PLT-20 FR-6). */
export function dueReminderThreshold(
  daysLeft: number,
): (typeof EXPIRY_REMINDER_DAYS)[number] | null {
  if (daysLeft > EXPIRY_REMINDER_DAYS[0]) return null;
  if (daysLeft <= 0) return 0;
  if (daysLeft <= EXPIRY_REMINDER_DAYS[1]) return 7;
  return 30;
}

const ARABIC_DIACRITICS = /[ً-ْٰـ]/g;

/**
 * T-52: the text stored in `search_key` and the text searched for. Lower case, Arabic alef and
 * hamza forms folded to ا, ى to ي, ة to ه, diacritics and tatweel removed, spaces collapsed.
 */
export function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('en')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}
