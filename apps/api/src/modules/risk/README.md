# Risk module (Sprint 11: PLT-34)

The company risk matrix (T-87, O-160 answering Q-22). One current matrix per company; every save
is a new immutable version, so a rating made on version 1 still reads the same after version 2.

| File              | What it does                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `risk.schema.ts`  | `risk_matrix_version`: size, likelihood and consequence levels, bands (JSON).             |
| `risk.service.ts` | `RiskMatrixDirectory` (current, by version; creates the default) and `RiskMatrixService`. |
| `risk.routes.ts`  | `GET/PUT /risk-matrix`, `POST /risk-matrix/reset`, `GET /risk-matrix/versions[/{no}]`.    |

## Rules worth knowing

- The default is 5×5 (Rare … Almost certain × Insignificant … Catastrophic) with Low 1–4,
  Medium 5–9, High 10–16, Critical 20–25; 4×4 can be chosen with Reset.
- `validateRiskMatrix` (shared) refuses a matrix where any possible score falls in no band or in
  two bands; ranges may skip numbers that are no product (17–19 on a 5×5).
- Rate with the shared `rateRisk(matrix, likelihood, consequence)` and store a
  `RiskRatingSnapshot` (version, levels, score, band key and label) on your own record.
- A trigger refuses `UPDATE` and `DELETE` on `risk_matrix_version`.
