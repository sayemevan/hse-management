import { ErrorCode, type ReadinessIssue, type TemplateIssue } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

export class TemplateNameTakenError extends AppError {
  constructor() {
    super(ErrorCode.TEMPLATE_NAME_TAKEN, 409, 'Another template already has this name.');
  }
}

export class CategoryNameTakenError extends AppError {
  constructor() {
    super(ErrorCode.LIST_ITEM_NAME_TAKEN, 409, 'This category already exists.');
  }
}

export class TemplateDraftExistsError extends AppError {
  constructor() {
    super(ErrorCode.TEMPLATE_DRAFT_EXISTS, 409, 'This template already has a draft.');
  }
}

export class TemplateDraftChangedError extends AppError {
  constructor() {
    super(
      ErrorCode.TEMPLATE_DRAFT_CHANGED,
      409,
      'Someone else changed this draft. Reload it to see their changes.',
    );
  }
}

export class TemplateInvalidError extends AppError {
  constructor(issues: readonly TemplateIssue[]) {
    super(ErrorCode.TEMPLATE_INVALID, 422, 'The template is not ready to publish.', {
      details: issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
}

export class TemplateInUseError extends AppError {
  constructor() {
    super(ErrorCode.TEMPLATE_IN_USE, 409, 'A published template is kept; retire it instead.');
  }
}

export class TemplateRetiredError extends AppError {
  constructor() {
    super(ErrorCode.TEMPLATE_RETIRED, 409, 'This template is retired.');
  }
}

export class TemplateVersionNotAllowedError extends AppError {
  constructor() {
    super(
      ErrorCode.TEMPLATE_VERSION_NOT_ALLOWED,
      422,
      'This version of the template can no longer be used for new inspections.',
    );
  }
}

export class TemplateLimitError extends AppError {
  constructor(max: number) {
    super(ErrorCode.TEMPLATE_LIMIT_REACHED, 422, `A company can have up to ${String(max)} active templates.`, {
      params: { max },
    });
  }
}

export class InspectionLockedError extends AppError {
  constructor() {
    super(ErrorCode.INSPECTION_LOCKED, 409, 'This inspection can no longer be changed.');
  }
}

export class InspectionTransitionError extends AppError {
  constructor(status: string) {
    super(
      ErrorCode.INSPECTION_TRANSITION_NOT_ALLOWED,
      409,
      'This step is not possible for the inspection in its current status.',
      { params: { status } },
    );
  }
}

export class InspectionIncompleteError extends AppError {
  constructor(issues: readonly ReadinessIssue[]) {
    const evidenceOnly = issues.every((issue) => issue.reason === 'photoRequired');
    super(
      evidenceOnly ? ErrorCode.INSPECTION_EVIDENCE_REQUIRED : ErrorCode.INSPECTION_INCOMPLETE,
      422,
      'Some items still need attention before the inspection can be submitted.',
      {
        details: issues.map((issue) => ({
          path: issue.itemKey ? `items.${issue.itemKey}` : 'place',
          message: issue.reason,
        })),
        params: { count: issues.length },
      },
    );
  }
}

export class ItemUnknownError extends AppError {
  constructor() {
    super(ErrorCode.INSPECTION_ITEM_UNKNOWN, 422, 'This item is not part of the inspection.');
  }
}

export class InspectorNotEligibleError extends AppError {
  constructor() {
    super(
      ErrorCode.INSPECTION_INSPECTOR_NOT_ELIGIBLE,
      422,
      "This person can't carry out inspections on this project.",
    );
  }
}

export class SelfApprovalError extends AppError {
  constructor() {
    super(ErrorCode.INSPECTION_SELF_APPROVAL, 403, "You can't review or approve your own inspection.");
  }
}

export class NotInspectorError extends AppError {
  constructor() {
    super(ErrorCode.INSPECTION_NOT_INSPECTOR, 403, 'Only the inspector of this inspection can do this.');
  }
}

export class InspectionFileLimitError extends AppError {
  constructor(scope: 'item' | 'header' | 'total', max: number) {
    super(ErrorCode.INSPECTION_FILE_LIMIT, 422, `You can add up to ${String(max)} files here.`, {
      params: { scope, max },
    });
  }
}

export class FindingOwnerRequiredError extends AppError {
  constructor(findingIds: readonly string[]) {
    super(ErrorCode.FINDING_OWNER_REQUIRED, 422, 'Choose who is responsible for each finding.', {
      details: findingIds.map((id) => ({ path: `findings.${id}`, message: 'ownerRequired' })),
    });
  }
}

export class FindingLockedError extends AppError {
  constructor() {
    super(ErrorCode.FINDING_LOCKED, 409, 'This finding is resolved and can no longer be changed.');
  }
}

export class PlaceRequiredError extends AppError {
  constructor() {
    super(ErrorCode.PLACE_REQUIRED, 422, 'Choose an area for this inspection.');
  }
}

/** O-50: Planning, On Hold and Completed projects accept no new records. */
export class ProjectNotAcceptingRecordsError extends AppError {
  constructor(status: string) {
    super(
      ErrorCode.PROJECT_NOT_ACCEPTING_RECORDS,
      409,
      "This project doesn't accept new records in its current status.",
      { params: { status } },
    );
  }
}
