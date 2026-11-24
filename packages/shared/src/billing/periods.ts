import type { BillingCycle, SubscriptionState } from './subscription-contracts';

/**
 * Subscription period arithmetic (PLT-10 FR-3, O-33), shared so the System Owner's confirm
 * form previews exactly the period the API will record.
 */

export interface PeriodDates {
  trialEndsAt: number | null;
  currentPeriodEnd: number | null;
}

/**
 * Adds calendar months in UTC, keeping the time of day. A start on the 29th–31st ends on the
 * last day of the target month when that day doesn't exist.
 */
export function addMonths(epochMs: number, months: number): number {
  const day = new Date(epochMs).getUTCDate();
  const target = new Date(epochMs);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

export function periodEnd(start: number, cycle: BillingCycle): number {
  return addMonths(start, cycle === 'monthly' ? 1 : 12);
}

/**
 * When a newly confirmed period starts. During the trial: at the trial end (or after a period
 * already confirmed). While a paid period runs: at its end. In grace or read-only: now.
 */
export function nextPeriodStart(state: SubscriptionState, dates: PeriodDates, now: number): number {
  if (state === 'trial') return dates.currentPeriodEnd ?? dates.trialEndsAt ?? now;
  if (state === 'active' && dates.currentPeriodEnd !== null) return dates.currentPeriodEnd;
  return now;
}
