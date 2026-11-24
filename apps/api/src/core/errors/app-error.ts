import { ErrorCode, type ValidationIssue } from '@hse/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface AppErrorOptions {
  details?: ValidationIssue[];
  /** Values for the client-side translated message, e.g. { minutes: 12 }. */
  params?: Record<string, string | number>;
  cause?: unknown;
}

/**
 * Base class for expected, user-facing failures.
 * `message` must be safe to show to end users; technical detail goes in `cause` (logged only).
 */
export class AppError extends Error {
  readonly details: ValidationIssue[] | undefined;
  readonly params: Record<string, string | number> | undefined;

  constructor(
    readonly code: ErrorCode,
    readonly status: ContentfulStatusCode,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.details = options.details;
    this.params = options.params;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'The request could not be processed.', options?: AppErrorOptions) {
    super(ErrorCode.BAD_REQUEST, 400, message, options);
  }
}

export class ValidationError extends AppError {
  constructor(
    details: ValidationIssue[],
    message = 'Some fields are invalid. Please review them.',
  ) {
    super(ErrorCode.VALIDATION_FAILED, 422, message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Please sign in to continue.') {
    super(ErrorCode.UNAUTHENTICATED, 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(ErrorCode.FORBIDDEN, 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(ErrorCode.NOT_FOUND, 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state of the resource.') {
    super(ErrorCode.CONFLICT, 409, message);
  }
}

/**
 * Raised when the deployment itself is misconfigured. Never shown to users:
 * the error handler logs it and answers with a generic 500.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many attempts. Please wait a moment and try again.') {
    super(ErrorCode.RATE_LIMITED, 429, message);
  }
}
