import type { Principal } from '../../core/auth/principal';
import type { Database } from '../../database/client';

/** What a source module says about one of its records (T-57). */
export interface ActionSourceRecord {
  /** Shown on the action and kept as a snapshot, e.g. "Inspection INS-0042, item 7". */
  label: string;
  /** Web route of the record, relative to the company site. */
  href: string | null;
  projectId: string;
}

/**
 * A module that creates actions (T-57). Registered once at start-up. The engine never imports
 * a source module; it only calls these functions.
 */
export interface ActionSource {
  readonly module: string;
  describe(db: Database, companyId: string, recordId: string): Promise<ActionSourceRecord | null>;
  /** May narrow who sees this source's actions (T-65). Default: no extra rule. */
  canView?(db: Database, principal: Principal, recordId: string): Promise<boolean>;
}

const sources = new Map<string, ActionSource>();

export function registerActionSource(source: ActionSource): void {
  sources.set(source.module, source);
}

export function actionSource(module: string): ActionSource | undefined {
  return sources.get(module);
}

/** `manual`: no record (US-053). `action`: a follow-up of a closed action (O-97), built in. */
export const MANUAL_SOURCE_LABEL = 'manual';
