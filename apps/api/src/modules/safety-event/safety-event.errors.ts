import { ErrorCode } from "@hse/shared";

import { AppError } from "../../core/errors/app-error";

export class SafetyListNameTakenError extends AppError {
  constructor() {
    super(
      ErrorCode.LIST_ITEM_NAME_TAKEN,
      409,
      "This name is already in the list.",
    );
  }
}

export class SafetyEventLockedError extends AppError {
  constructor(message = "This safety event can no longer be changed.") {
    super(ErrorCode.SAFETY_EVENT_LOCKED, 409, message);
  }
}

export class SafetyEventTransitionError extends AppError {
  constructor(status: string) {
    super(
      ErrorCode.SAFETY_EVENT_TRANSITION_NOT_ALLOWED,
      409,
      "This step is not possible now.",
      {
        params: { status },
      },
    );
  }
}

export class NotReporterError extends AppError {
  constructor() {
    super(
      ErrorCode.SAFETY_EVENT_NOT_REPORTER,
      403,
      "Only the reporter can change the report.",
    );
  }
}

export class EventTypeInactiveError extends AppError {
  constructor() {
    super(
      ErrorCode.SAFETY_EVENT_TYPE_INACTIVE,
      422,
      "This event type is no longer in use.",
    );
  }
}

export class FamilyLockedError extends AppError {
  constructor() {
    super(
      ErrorCode.SAFETY_EVENT_FAMILY_LOCKED,
      409,
      "The family of a type in use cannot change.",
    );
  }
}

export class SeverityBelowMinimumError extends AppError {
  constructor(minimum: string) {
    super(
      ErrorCode.SAFETY_EVENT_SEVERITY_BELOW_MINIMUM,
      422,
      "The severity is below the minimum for this type.",
      { params: { minimum } },
    );
  }
}

export class EventTimeInvalidError extends AppError {
  constructor(reason: "future" | "tooOld") {
    super(
      ErrorCode.SAFETY_EVENT_TIME_INVALID,
      422,
      "The date and time of the event are not valid.",
      {
        params: { reason },
      },
    );
  }
}

export class InvestigationRequiredError extends AppError {
  constructor() {
    super(
      ErrorCode.SAFETY_EVENT_INVESTIGATION_REQUIRED,
      409,
      "This event must be investigated before it can be acted on or closed.",
    );
  }
}

export class InvestigationIncompleteError extends AppError {
  constructor(missing: readonly string[]) {
    super(
      ErrorCode.SAFETY_EVENT_INVESTIGATION_INCOMPLETE,
      422,
      "The investigation is not complete.",
      {
        details: missing.map((path) => ({ path, message: "required" })),
      },
    );
  }
}

export class InvestigationChangedError extends AppError {
  constructor() {
    super(
      ErrorCode.SAFETY_EVENT_INVESTIGATION_CHANGED,
      409,
      "Someone else changed the investigation. Reload it to see their changes.",
    );
  }
}

export class InvestigatorNotEligibleError extends AppError {
  constructor() {
    super(
      ErrorCode.SAFETY_EVENT_INVESTIGATOR_NOT_ELIGIBLE,
      422,
      "This person cannot investigate events on this project.",
    );
  }
}

export class SelfClosureError extends AppError {
  constructor() {
    super(
      ErrorCode.SAFETY_EVENT_SELF_CLOSURE,
      403,
      "The lead investigator cannot close this event.",
    );
  }
}

export class OpenActionsError extends AppError {
  constructor() {
    super(
      ErrorCode.SAFETY_EVENT_OPEN_ACTIONS,
      409,
      "Some recommendations or actions are still open.",
    );
  }
}

export class SafetyEventFileLimitError extends AppError {
  constructor(limit: number) {
    super(
      ErrorCode.SAFETY_EVENT_FILE_LIMIT,
      422,
      "This event has reached its file limit.",
      {
        params: { limit },
      },
    );
  }
}

export class PersonLimitError extends AppError {
  constructor(limit: number) {
    super(
      ErrorCode.SAFETY_EVENT_PERSON_LIMIT,
      422,
      "Too many people on this event.",
      { params: { limit } },
    );
  }
}

export class WitnessLimitError extends AppError {
  constructor(limit: number) {
    super(
      ErrorCode.SAFETY_EVENT_WITNESS_LIMIT,
      422,
      "Too many witnesses on this event.",
      {
        params: { limit },
      },
    );
  }
}

export class RiskRatingRequiredError extends AppError {
  constructor() {
    super(
      ErrorCode.RISK_RATING_REQUIRED,
      422,
      "This event type needs a risk rating.",
    );
  }
}

export class RecommendationLockedError extends AppError {
  constructor() {
    super(
      ErrorCode.RECOMMENDATION_LOCKED,
      409,
      "This recommendation is already resolved.",
    );
  }
}

export class PlaceRequiredError extends AppError {
  constructor() {
    super(ErrorCode.PLACE_REQUIRED, 422, "Choose an area for this event.");
  }
}

/** O-181: only projects that accept records, or are On Hold, take new reports. */
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
