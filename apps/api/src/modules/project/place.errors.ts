import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

export class PlaceNameTakenError extends AppError {
  constructor() {
    super(ErrorCode.PLACE_NAME_TAKEN, 409, 'Another place here already has this name.');
  }
}

export class PlaceCodeTakenError extends AppError {
  constructor() {
    super(ErrorCode.PLACE_CODE_TAKEN, 409, 'This code is already used here.');
  }
}

/** T-39: a place with children or used by a record can't be deleted. */
export class PlaceInUseError extends AppError {
  constructor(reason: 'children' | 'records') {
    super(
      ErrorCode.PLACE_IN_USE,
      409,
      "This place is in use, so it can't be deleted. Deactivate it instead.",
      { params: { reason } },
    );
  }
}

/** US-019: no child under an inactive place, no reactivation under an inactive parent. */
export class PlaceInactiveError extends AppError {
  constructor() {
    super(ErrorCode.PLACE_INACTIVE, 409, 'The place above this one is inactive.');
  }
}

export class PlaceLevelInvalidError extends AppError {
  constructor() {
    super(ErrorCode.PLACE_LEVEL_INVALID, 422, "A place of this level can't be added here.");
  }
}

export class PlaceLimitReachedError extends AppError {
  constructor(limit: number) {
    super(ErrorCode.PLACE_LIMIT_REACHED, 422, 'This project has reached the number of places.', {
      params: { limit },
    });
  }
}
