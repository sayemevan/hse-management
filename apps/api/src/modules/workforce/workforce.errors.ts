import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

export class EmployeeIdTakenError extends AppError {
  constructor(name: string) {
    super(ErrorCode.WORKFORCE_EMPLOYEE_ID_TAKEN, 409, 'This employee ID is already used.', {
      params: { name },
    });
  }
}

export class DocumentNumberTakenError extends AppError {
  constructor(name: string) {
    super(ErrorCode.WORKFORCE_DOCUMENT_NUMBER_TAKEN, 409, 'This number is already recorded.', {
      params: { name },
    });
  }
}

/** O-79: archived profiles and their records are read-only. */
export class WorkforceArchivedError extends AppError {
  constructor() {
    super(ErrorCode.WORKFORCE_ARCHIVED, 409, 'This profile is archived and cannot be changed.');
  }
}

export class NotAssignableError extends AppError {
  constructor(status: string) {
    super(ErrorCode.WORKFORCE_NOT_ASSIGNABLE, 409, "This person can't be assigned now.", {
      params: { status },
    });
  }
}

export class AssignmentOverlapError extends AppError {
  constructor(from: string) {
    super(
      ErrorCode.WORKFORCE_ASSIGNMENT_OVERLAP,
      409,
      'This person is already assigned to the project for these dates.',
      { params: { from } },
    );
  }
}

export class UserAlreadyLinkedError extends AppError {
  constructor() {
    super(
      ErrorCode.WORKFORCE_USER_ALREADY_LINKED,
      409,
      'This account is already linked to a workforce profile.',
    );
  }
}

export class RecordVoidedError extends AppError {
  constructor() {
    super(ErrorCode.WORKFORCE_RECORD_VOIDED, 409, 'This record was voided or replaced.');
  }
}

export class WorkforceLimitReachedError extends AppError {
  constructor(limit: number) {
    super(
      ErrorCode.WORKFORCE_LIMIT_REACHED,
      422,
      'The company has reached the number of profiles.',
      {
        params: { limit },
      },
    );
  }
}

export class ArchiveRefusedError extends AppError {
  constructor(reason: 'status' | 'assignments') {
    super(ErrorCode.WORKFORCE_ARCHIVE_REFUSED, 422, "This profile can't be archived yet.", {
      params: { reason },
    });
  }
}

export class ContactLimitError extends AppError {
  constructor(limit: number) {
    super(ErrorCode.WORKFORCE_CONTACT_LIMIT, 422, 'Too many emergency contacts.', {
      params: { limit },
    });
  }
}

/** O-92: all or none; one `details` issue per refused person (as BULK_ADD_REFUSED). */
export class BulkAssignRefusedError extends AppError {
  constructor(refused: { memberId: string; name: string; reason: string; from?: string }[]) {
    super(
      ErrorCode.BULK_ASSIGN_REFUSED,
      422,
      "Some people can't be assigned. Nobody was assigned.",
      {
        details: refused.map((entry) => ({ path: entry.memberId, message: entry.reason })),
        params: { names: refused.map((entry) => entry.name).join(', '), count: refused.length },
      },
    );
  }
}

export class ProjectClosedForAssignmentError extends AppError {
  constructor() {
    super(
      ErrorCode.PROJECT_CLOSED_FOR_ASSIGNMENT,
      409,
      'This project is completed, so nobody can be assigned to it.',
    );
  }
}

export class WorkforceProjectArchivedError extends AppError {
  constructor() {
    super(ErrorCode.PROJECT_ARCHIVED, 409, 'This project is archived and cannot be changed.');
  }
}

export class ListItemNameTakenError extends AppError {
  constructor() {
    super(ErrorCode.LIST_ITEM_NAME_TAKEN, 409, 'This name is already in the list.');
  }
}

export class ListItemInUseError extends AppError {
  constructor(usage: number) {
    super(ErrorCode.LIST_ITEM_IN_USE, 409, "This item is used, so it can't be deleted.", {
      params: { usage },
    });
  }
}

export class ListItemInactiveError extends AppError {
  constructor() {
    super(ErrorCode.LIST_ITEM_INACTIVE, 422, 'Choose an active item from the list.');
  }
}

export class ListLimitReachedError extends AppError {
  constructor(limit: number) {
    super(ErrorCode.LIST_LIMIT_REACHED, 422, 'The list has reached its size.', {
      params: { limit },
    });
  }
}
