import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

/** PLT-29: the `Idempotency-Key` header is not a UUID. */
export class IdempotencyKeyInvalidError extends AppError {
  constructor() {
    super(ErrorCode.IDEMPOTENCY_KEY_INVALID, 400, 'The Idempotency-Key header must be a UUID.');
  }
}

/** PLT-29: the key was used before for another request (other body, route or user). */
export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super(
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      422,
      'This request key was already used for a different change.',
    );
  }
}

/** T-68: a client-generated id that belongs to another record. */
export class RecordIdTakenError extends AppError {
  constructor() {
    super(ErrorCode.RECORD_ID_TAKEN, 409, 'This record id is already in use.');
  }
}

/**
 * T-70: the record changed on the server since the device last saw it. Nothing was applied;
 * both versions are kept in `sync_conflict` (D-20). The device reads them by `conflictId`.
 */
export class SyncConflictError extends AppError {
  constructor(
    readonly conflictId: string | null,
    readonly serverVersion: number,
  ) {
    super(
      ErrorCode.SYNC_CONFLICT,
      409,
      'This record was changed by someone else. Review both versions.',
      { params: conflictId ? { conflictId, serverVersion } : { serverVersion } },
    );
  }
}

/** PLT-30: the conflict was already resolved or discarded. */
export class SyncConflictResolvedError extends AppError {
  constructor() {
    super(ErrorCode.SYNC_CONFLICT_RESOLVED, 409, 'This conflict has already been resolved.');
  }
}
