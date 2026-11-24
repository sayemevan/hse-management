import type { Database } from '../../database/client';

/**
 * T-39: later modules (inspections, permits, …) tell the project module whether a place is
 * used by one of their records, so it can't be deleted. Registered once at start-up.
 */
export interface PlaceUsage {
  /** e.g. `inspection`. */
  readonly module: string;
  countRecordsUsing(db: Database, placeId: string): Promise<number>;
}

const usages: PlaceUsage[] = [];

export function registerPlaceUsage(usage: PlaceUsage): void {
  if (!usages.some((existing) => existing.module === usage.module)) usages.push(usage);
}

export async function countRecordsUsing(db: Database, placeId: string): Promise<number> {
  let total = 0;
  for (const usage of usages) total += await usage.countRecordsUsing(db, placeId);
  return total;
}
