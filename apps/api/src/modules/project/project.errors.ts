import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

export class ProjectCodeTakenError extends AppError {
  constructor() {
    super(ErrorCode.PROJECT_CODE_TAKEN, 409, 'This code is already used by another project.');
  }
}

/** O-51: the code is fixed once the project leaves Planning. */
export class ProjectCodeLockedError extends AppError {
  constructor() {
    super(
      ErrorCode.PROJECT_CODE_LOCKED,
      409,
      "The code can't be changed once the project has started.",
    );
  }
}

export class InvalidStatusTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(ErrorCode.INVALID_STATUS_TRANSITION, 409, `A project can't move from ${from} to ${to}.`, {
      params: { from, to },
    });
  }
}

/** US-018 FR-2: archived projects are read-only. */
export class ProjectArchivedError extends AppError {
  constructor() {
    super(ErrorCode.PROJECT_ARCHIVED, 409, 'This project is archived and cannot be changed.');
  }
}

export class ProjectChangedError extends AppError {
  constructor() {
    super(
      ErrorCode.CONFLICT,
      409,
      'This project was changed by someone else. Reload to see the changes.',
    );
  }
}
