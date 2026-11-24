import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

/** Wrong email or password, unknown account, or wrong subdomain — never says which (O-1). */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super(ErrorCode.INVALID_CREDENTIALS, 401, 'Invalid email or password.');
  }
}

/** Shown only after a correct password, or to an already signed-in user (O-1). */
export class AccountTemporarilyLockedError extends AppError {
  constructor(minutes: number) {
    super(
      ErrorCode.ACCOUNT_TEMPORARILY_LOCKED,
      423,
      `Too many failed attempts. Try again in ${minutes} minutes.`,
      { params: { minutes } },
    );
  }
}

export class AccountInactiveError extends AppError {
  constructor() {
    super(
      ErrorCode.ACCOUNT_INACTIVE,
      403,
      'Your account is not active. Contact your company administrator.',
    );
  }
}

export class SessionExpiredError extends AppError {
  constructor() {
    super(ErrorCode.SESSION_EXPIRED, 401, 'Your session has expired. Please sign in again.');
  }
}

export class CurrentPasswordIncorrectError extends AppError {
  constructor() {
    super(ErrorCode.CURRENT_PASSWORD_INCORRECT, 400, 'Your current password is incorrect.');
  }
}

export class PasswordUnchangedError extends AppError {
  constructor() {
    super(ErrorCode.PASSWORD_UNCHANGED, 400, 'Choose a password you are not using now.');
  }
}

export class CannotRevokeCurrentSessionError extends AppError {
  constructor() {
    super(
      ErrorCode.CANNOT_REVOKE_CURRENT_SESSION,
      400,
      'Use Sign out to end the session on this device.',
    );
  }
}

export class SessionNotFoundError extends AppError {
  constructor() {
    super(ErrorCode.NOT_FOUND, 404, 'This session was not found.');
  }
}

/** Reset or invitation link that is unknown, used, expired or for another company. */
export class ResetLinkInvalidError extends AppError {
  constructor() {
    super(
      ErrorCode.TOKEN_INVALID_OR_EXPIRED,
      400,
      'This link has expired or was already used. Request a new one.',
    );
  }
}

export class InvitationLinkInvalidError extends AppError {
  constructor() {
    super(
      ErrorCode.TOKEN_INVALID_OR_EXPIRED,
      400,
      'This invitation has expired or was already used. Ask your administrator for a new one.',
    );
  }
}

/** D-08: an email belongs to one account on the whole platform. Never says which company. */
export class EmailInUseError extends AppError {
  constructor() {
    super(
      ErrorCode.EMAIL_IN_USE,
      409,
      'This email address is already registered on the platform.',
      {
        details: [{ path: 'email', message: 'emailInUse' }],
      },
    );
  }
}

/** O-26: active plus pending users can't exceed the plan's user limit. */
export class InvitationNotPendingError extends AppError {
  constructor() {
    super(ErrorCode.INVITATION_NOT_PENDING, 409, 'This user has no pending invitation.');
  }
}

export class UserNotFoundError extends AppError {
  constructor() {
    super(ErrorCode.NOT_FOUND, 404, 'This user was not found.');
  }
}

/** US-006 FR-5: at most 5 resends per invitation per day. */
export class InvitationResendLimitError extends AppError {
  constructor() {
    super(
      ErrorCode.RATE_LIMITED,
      429,
      'This invitation was resent too often today. Try again tomorrow.',
    );
  }
}

/** O-24: a company always keeps one active Company Administrator. */
export class LastAdministratorError extends AppError {
  constructor() {
    super(
      ErrorCode.LAST_ADMINISTRATOR,
      422,
      'At least one active Company Administrator is required.',
    );
  }
}

/** PLT-16: the role can't be given at this scope (for example Company Administrator on a project). */
export class RoleNotAllowedError extends AppError {
  constructor() {
    super(ErrorCode.ROLE_NOT_ALLOWED, 422, "This role can't be given on a project.");
  }
}

/** O-54: a locked permission can't be turned off. */
export class PermissionLockedError extends AppError {
  constructor(permission: string) {
    super(ErrorCode.PERMISSION_LOCKED, 422, `${permission} can't be turned off for this role.`, {
      params: { permission },
    });
  }
}
