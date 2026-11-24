import { ErrorCode } from '@hse/shared';

import { AppError, ConflictError } from '../../core/errors/app-error';

/** D-30: a read-only company can view and export, but not change anything. */
export class CompanyReadOnlyError extends AppError {
  constructor() {
    super(
      ErrorCode.COMPANY_READ_ONLY,
      403,
      'Your company account is read-only until payment is confirmed.',
    );
  }
}

/** Optimistic concurrency (US-012 FR-4, US-013): someone saved a newer version first. */
export class CompanyChangedError extends ConflictError {
  constructor() {
    super('Someone else changed these details. Reload to see the latest version.');
  }
}
