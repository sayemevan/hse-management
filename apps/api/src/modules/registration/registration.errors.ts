import { ErrorCode, type SlugUnavailableReason } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

export class BotCheckFailedError extends AppError {
  constructor() {
    super(
      ErrorCode.BOT_CHECK_FAILED,
      400,
      "We couldn't confirm you're not a robot. Please try again.",
    );
  }
}

export class SlugUnavailableError extends AppError {
  constructor(reason: SlugUnavailableReason) {
    super(ErrorCode.SLUG_UNAVAILABLE, 409, 'This address is already taken. Try another.', {
      details: [{ path: 'slug', message: reason }],
    });
  }
}

export class TokenInvalidError extends AppError {
  constructor() {
    super(ErrorCode.TOKEN_INVALID_OR_EXPIRED, 400, 'This link has expired or was already used.');
  }
}

export class RegistrationNotFoundError extends AppError {
  constructor() {
    super(ErrorCode.NOT_FOUND, 404, 'This application was not found.');
  }
}

export class RegistrationAlreadyDecidedError extends AppError {
  constructor() {
    super(
      ErrorCode.REGISTRATION_ALREADY_DECIDED,
      409,
      'This application has already been decided.',
    );
  }
}

/** The subdomain or the applicant email was taken after the application was submitted. */
export class RegistrationConflictError extends AppError {
  constructor() {
    super(
      ErrorCode.REGISTRATION_CONFLICT,
      409,
      'The subdomain or email is no longer available. Reject the application and ask the applicant to choose another.',
    );
  }
}
