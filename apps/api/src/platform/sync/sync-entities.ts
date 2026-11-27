import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import type { OfflineMeta } from './offline-meta';

/** The server's current version of a record, for detection and the review screen. */
export interface SyncSnapshot {
  version: number;
  /** The fields the review screen compares (at least the module's `conflictFields`). */
  values: Record<string, unknown>;
  projectId: string | null;
  projectCode: string | null;
  /** "Sync probe Pump check", later "Inspection RMX-02-INS-0042". */
  label: string;
  /** The user who made the server's version, when known. */
  changedBy: string | null;
}

export interface PrepareUpdateInput {
  db: Database;
  companyId: string;
  principal: Principal;
  entityId: string;
  values: Record<string, unknown>;
  /** The version the change applies to; the statements must fail the batch otherwise. */
  expectVersion: number;
  offline: OfflineMeta | null;
  meta: RequestMeta;
  now: number;
}

export interface PreparedUpdate {
  statements: Statement[];
  /** The record as it will be after the change (the resolve answer). */
  record: Record<string, unknown>;
}

/**
 * A record type that can be changed offline (T-70, T-72). The module registers it in its
 * `index.ts`; the conflict service never imports the module.
 */
export interface SyncEntity {
  type: string;
  /** Fields the user may combine field by field (O-122). */
  conflictFields: readonly string[];
  snapshot(db: Database, companyId: string, entityId: string): Promise<SyncSnapshot | undefined>;
  /**
   * The module's normal update (permissions, validation, audit) as statements, guarded on
   * `expectVersion` (the batch fails with the guard error when the record moved).
   */
  prepareUpdate(input: PrepareUpdateInput): Promise<PreparedUpdate>;
}

const entities = new Map<string, SyncEntity>();

export function registerSyncEntity(entity: SyncEntity): void {
  entities.set(entity.type, entity);
}

export function syncEntity(type: string): SyncEntity | undefined {
  return entities.get(type);
}

/** SQLite raises this for `json('…')`: the version guard of a batch failed (T-58 pattern). */
export const VERSION_GUARD_MESSAGE = 'malformed JSON';

export function isVersionGuardFailure(error: unknown): boolean {
  const text = String((error as { message?: unknown } | null)?.message ?? error);
  return text.includes(VERSION_GUARD_MESSAGE);
}
