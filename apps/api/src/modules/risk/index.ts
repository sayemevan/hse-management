/**
 * Risk module — public contract (Sprint 11: PLT-34; T-87, D-62, D-63).
 *
 * Purpose: the one company risk matrix (size, likelihood and consequence labels, score bands),
 * versioned so ratings keep the version they were made with. Used by safety events now and by
 * risk assessments (Sprint 12) next.
 * Dependencies: identity (permissions, names), platform/audit-log.
 * Other modules read the matrix only through `RiskMatrixDirectory` and rate with the shared
 * `rateRisk`; they never read `risk_matrix_version`.
 */
export { RiskMatrixDirectory, type RiskMatrixVersion } from "./risk.service";
export { riskMatrixRoutes } from "./risk.routes";
export { riskMatrixVersion } from "./risk.schema";
