import type { SubscriptionState } from '@hse/shared';

/**
 * Subscription lifecycle rules (PLT-10). Pure functions of the dates and the clock, so the
 * same answer is given at request time (T-22) and by the daily job.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface LifecycleSettings {
  graceMs: number;
  pendingProofHoldMs: number;
}

export interface LifecycleDates {
  trialEndsAt: number | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
}

/** Most permissive first: a lower rank keeps more rights. */
const RANK: Record<SubscriptionState, number> = { trial: 0, active: 0, grace: 1, read_only: 2 };

/** FR-1: the state at time `at`, from the dates alone. */
export function stateAt(dates: LifecycleDates, at: number, settings: LifecycleSettings) {
  const { trialEndsAt, currentPeriodEnd } = dates;
  if (trialEndsAt !== null && at < trialEndsAt) return 'trial' satisfies SubscriptionState;
  if (currentPeriodEnd === null) return 'read_only' satisfies SubscriptionState; // O-31
  if (at < currentPeriodEnd) return 'active' satisfies SubscriptionState;
  if (at < currentPeriodEnd + settings.graceMs) return 'grace' satisfies SubscriptionState;
  return 'read_only' satisfies SubscriptionState;
}

const morePermissive = (a: SubscriptionState, b: SubscriptionState) => (RANK[a] <= RANK[b] ? a : b);
const lessPermissive = (a: SubscriptionState, b: SubscriptionState) => (RANK[a] >= RANK[b] ? a : b);

/**
 * FR-1 and FR-2: the effective state. A payment proof still under review keeps the state the
 * company had when it was submitted, for at most the hold period after the deadline (O-32).
 * A proof sent after the deadline doesn't bring access back.
 */
export function effectiveState(
  dates: LifecycleDates,
  now: number,
  settings: LifecycleSettings,
  pendingProofSubmittedAt: number | null,
): SubscriptionState {
  const current = stateAt(dates, now, settings);
  if (pendingProofSubmittedAt === null) return current;
  const held = lessPermissive(
    stateAt(dates, now - settings.pendingProofHoldMs, settings),
    stateAt(dates, pendingProofSubmittedAt, settings),
  );
  return morePermissive(current, held);
}

/** The deadline that matters in a state: trial end, period end or grace end. */
export function deadlineFor(
  state: SubscriptionState,
  dates: LifecycleDates,
  settings: LifecycleSettings,
): number | null {
  if (state === 'trial') return dates.trialEndsAt;
  if (state === 'active') return dates.currentPeriodEnd;
  if (state === 'grace' && dates.currentPeriodEnd !== null) {
    return dates.currentPeriodEnd + settings.graceMs;
  }
  return null;
}

// Period arithmetic lives in the shared package so the web app previews the same dates.
export { addMonths, nextPeriodStart, periodEnd } from '@hse/shared';

/**
 * Number of calendar days from `now` to `deadline` in a time zone: 0 on the deadline's own
 * day, 1 the day before (PLT-15 FR-3).
 */
export function calendarDaysUntil(now: number, deadline: number, timeZone: string): number {
  return Math.round((dayNumber(deadline, timeZone) - dayNumber(now, timeZone)) / DAY_MS);
}

function dayNumber(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(epochMs);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day'));
}

/** Today's date (`YYYY-MM-DD`) in a time zone. */
export function isoDateIn(epochMs: number, timeZone: string): string {
  return new Date(dayNumber(epochMs, timeZone)).toISOString().slice(0, 10);
}

/**
 * The reminder due now for a list of thresholds such as [7, 3, 1]: the most urgent threshold
 * that has been reached, or null. A missed reminder is replaced by the next one, so each
 * window sends at most one email (PLT-15 FR-3).
 */
export function dueThreshold(daysLeft: number, thresholds: readonly number[]): number | null {
  if (daysLeft < 0) return null;
  const reached = thresholds.filter((days) => daysLeft <= days);
  return reached.length === 0 ? null : Math.min(...reached);
}
