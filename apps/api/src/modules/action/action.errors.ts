import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

/** T-58: the move isn't in the workflow for this status (or someone moved it first). */
export class TransitionNotAllowedError extends AppError {
  constructor(status: string) {
    super(
      ErrorCode.ACTION_TRANSITION_NOT_ALLOWED,
      409,
      'This step is not possible for the action in its current status.',
      { params: { status } },
    );
  }
}

/** O-105, O-106: closed and voided actions are read-only. */
export class ActionLockedError extends AppError {
  constructor() {
    super(ErrorCode.ACTION_LOCKED, 409, 'This action is closed or voided and cannot be changed.');
  }
}

export class OwnerNotEligibleError extends AppError {
  constructor() {
    super(
      ErrorCode.ACTION_OWNER_NOT_ELIGIBLE,
      422,
      "This person can't be assigned actions on this project.",
    );
  }
}

export class VerifierIsParticipantError extends AppError {
  constructor() {
    super(
      ErrorCode.ACTION_VERIFIER_IS_PARTICIPANT,
      422,
      "You can't verify an action you worked on.",
    );
  }
}

export class EvidenceRequiredError extends AppError {
  constructor(priority: string) {
    super(
      ErrorCode.ACTION_EVIDENCE_REQUIRED,
      422,
      'Add at least one photo or document for a High or Critical priority action.',
      { params: { priority } },
    );
  }
}

export class DueDateInvalidError extends AppError {
  constructor() {
    super(
      ErrorCode.ACTION_DUE_DATE_INVALID,
      422,
      'The due date must be between today and two years ahead.',
    );
  }
}

export class FileLimitError extends AppError {
  constructor(max: number) {
    super(ErrorCode.ACTION_FILE_LIMIT, 422, `An action can have up to ${String(max)} files.`, {
      params: { max },
    });
  }
}

export class CollaboratorLimitError extends AppError {
  constructor(max: number) {
    super(
      ErrorCode.ACTION_COLLABORATOR_LIMIT,
      422,
      `An action can have up to ${String(max)} collaborators.`,
      { params: { max } },
    );
  }
}

export class ReasonRequiredError extends AppError {
  constructor() {
    super(ErrorCode.ACTION_REASON_REQUIRED, 422, 'Give a reason for this change.');
  }
}

/** O-111: new records only on Mobilization and Active projects. */
export class ProjectNotAcceptingRecordsError extends AppError {
  constructor(status: string) {
    super(
      ErrorCode.PROJECT_NOT_ACCEPTING_RECORDS,
      409,
      'New records can only be added to projects in Mobilization or Active.',
      { params: { status } },
    );
  }
}
