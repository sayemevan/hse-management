/**
 * Sync platform service (Sprint 9: PLT-29, PLT-30; D-56, D-57).
 *
 * - `idempotent()` on offline-capable write routes and `IdempotencyService.record()` in the
 *   change's `UnitOfWork` (T-69): a change sent twice is applied once.
 * - `registerSyncEntity()` for record types that can change offline, and `SyncConflictService`
 *   to record (`detect`) and resolve conflicts (T-70, D-20). Both versions are kept.
 * - `offlineMetaOf()` / `offlineAudit()` for capture times and device ids (O-129, O-130).
 */
export {
  idempotencyClaimOf,
  idempotent,
  type IdempotentOptions,
  type IdempotentResult,
  IdempotencyService,
} from './idempotency';
export { offlineAudit, type OfflineMeta, offlineMetaOf } from './offline-meta';
export { type DetectInput, SyncConflictService } from './sync-conflict.service';
export {
  isVersionGuardFailure,
  type PreparedUpdate,
  type PrepareUpdateInput,
  registerSyncEntity,
  type SyncEntity,
  syncEntity,
  type SyncSnapshot,
} from './sync-entities';
export {
  IdempotencyKeyInvalidError,
  IdempotencyKeyReusedError,
  RecordIdTakenError,
  SyncConflictError,
  SyncConflictResolvedError,
} from './sync.errors';
export { idempotencyKey, syncConflict, type SyncConflictRow } from './sync.schema';
