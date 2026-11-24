import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

/** Unknown, malformed or inactive subdomain. Never says which of these it was (PLT-02). */
export class TenantNotFoundError extends AppError {
  constructor() {
    super(ErrorCode.TENANT_NOT_FOUND, 404, 'This company address was not found.');
  }
}

/** The signed-in user does not belong to this subdomain's company. */
export class TenantAccessDeniedError extends AppError {
  constructor() {
    super(ErrorCode.TENANT_ACCESS_DENIED, 403, 'You do not have access to this company.');
  }
}
