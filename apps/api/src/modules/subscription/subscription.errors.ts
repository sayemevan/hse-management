import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';
import type { LimitedResource } from './plan-limit.service';

const LIMIT_MESSAGES: Record<LimitedResource, (limit: number, used: number) => string> = {
  users: (limit) => `Your plan allows ${limit} users. Upgrade the plan to add more.`,
  projects: (limit) => `Your plan allows ${limit} projects. Upgrade the plan to add more.`,
  storage: (limit, used) =>
    `Not enough storage left on your plan: ${formatBytes(Math.max(0, limit - used))} free.`,
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** PLT-12 FR-7. `params` carry the values for the translated client message. */
export class PlanLimitReachedError extends AppError {
  constructor(resource: LimitedResource, limit: number, used: number) {
    super(ErrorCode.PLAN_LIMIT_REACHED, 409, LIMIT_MESSAGES[resource](limit, used), {
      params: { resource, limit, used, free: Math.max(0, limit - used) },
    });
  }
}

/** PLT-11: writes are refused while the subscription is unpaid (D-18, D-30). */
export class SubscriptionReadOnlyError extends AppError {
  constructor(readOnlySince: number | null) {
    super(
      ErrorCode.SUBSCRIPTION_READ_ONLY,
      403,
      'This workspace is read-only until the subscription is paid.',
      readOnlySince === null ? {} : { params: { readOnlySince } },
    );
  }
}

export class PlanNotAvailableError extends AppError {
  constructor() {
    super(ErrorCode.PLAN_NOT_AVAILABLE, 409, 'This plan is not available.');
  }
}

export class PaymentAlreadyPendingError extends AppError {
  constructor() {
    super(
      ErrorCode.PAYMENT_ALREADY_PENDING,
      409,
      'A payment is already under review. Withdraw it to submit a new one.',
    );
  }
}

export class PaymentAlreadyReviewedError extends AppError {
  constructor() {
    super(ErrorCode.PAYMENT_ALREADY_REVIEWED, 409, 'This payment has already been reviewed.');
  }
}
