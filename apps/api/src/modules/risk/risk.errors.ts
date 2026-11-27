import { ErrorCode, type RiskMatrixIssue } from "@hse/shared";

import { AppError } from "../../core/errors/app-error";

export class RiskMatrixInvalidError extends AppError {
  constructor(issues: readonly RiskMatrixIssue[]) {
    super(ErrorCode.RISK_MATRIX_INVALID, 422, "The risk matrix is not valid.", {
      details: issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    });
  }
}
