# PLT-34 — Company Risk Matrix

| Field    | Value                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform enabler (Doc 14 Epic 06 — Safety Event Engine; reused by Risk Assessment, Sprint 12)                                                           |
| Priority | Must                                                                                                                                                    |
| Status   | Approved                                                                                                                                                |
| Sources  | Product Book Doc 11 §12, Doc 23 (Risk Assessment), Doc 10 §13 (risk score); Master Rules "Master Data should be configurable"; Q-22; T-87; O-160, O-168 |

## Business Goal

Every company rates risk the same way everywhere — safety events now, risk assessments next sprint, inspection risk scores later — on a matrix it recognises, and a rating made today still reads the same after the matrix is changed (Doc 11 §12 "Organizations should be able to select their preferred assessment method").

## User Story

As an **HSE Manager**, I want to set my company's risk matrix (size, labels and score bands) once, so that everyone rates hazards and events against the same scale.

## Description

A new small **`risk` module** (API `modules/risk/`, shared `packages/shared/src/risk/`) owns the company **risk matrix**. Each company has exactly one current matrix; every save creates a new **immutable version** (`risk_matrix_version`). The default (O-160) is created on first read.

A matrix has:

- **size**: 5×5 (default) or 4×4;
- **likelihood levels** 1…n and **consequence levels** 1…n, each with a label and an optional description in English and Arabic;
- **bands**: an ordered list of score ranges, each with a key (`low`, `medium`, `high`, `critical`), a label (en, ar), a required response text (en, ar) and a display tone (used with the word, never alone).

`rateRisk(matrix, likelihood, consequence)` in `packages/shared` returns `{ score, band }` (score = likelihood × consequence). The same function runs in the review sheet (live) and on the server (stored). A rating is stored by the consumer as a **snapshot**: `{ matrixVersion, likelihood, consequence, score, bandKey, bandLabel: {en, ar} }`.

### Default matrix (O-160)

5×5 — likelihood: 1 Rare, 2 Unlikely, 3 Possible, 4 Likely, 5 Almost certain; consequence: 1 Insignificant, 2 Minor, 3 Moderate, 4 Major, 5 Catastrophic.

| Band     | Scores | Required response (default text)                                           |
| -------- | ------ | -------------------------------------------------------------------------- |
| Low      | 1–4    | Manage by routine procedures.                                              |
| Medium   | 5–9    | Reduce the risk; supervisor attention and controls within the agreed time. |
| High     | 10–16  | Senior attention; controls before work continues.                          |
| Critical | 20–25  | Stop work; immediate action; do not resume until the risk is reduced.      |

4×4 (selectable) — likelihood: Unlikely, Possible, Likely, Almost certain; consequence: Minor, Moderate, Major, Catastrophic; bands Low 1–3, Medium 4–6, High 8–9, Critical 12–16.

Arabic default labels are seeded with the English ones (PO may supply the wording; a draft list is in the seed).

### Screen

`<slug>/settings/risk-matrix` (needs `risk.matrix.manage`; readers see the matrix read-only from the review sheet's "How is this rated?" link):

1. Size switch (5×5 / 4×4) — switching proposes the default labels and bands of that size.
2. Labels table for likelihood and consequence (two languages).
3. Bands editor: from–to score per band, label, required response; the **preview grid** colours each cell with the band word inside it, so gaps or overlaps show at once.
4. **Save as new version** → "Version 3 is now used for new ratings. Ratings already made keep the version they were made with." · **Reset to default**.
5. **Versions**: list with date and author; open one read-only.

## Actors

Company Administrator, HSE Director, HSE Manager (`risk.matrix.manage`); every user who rates or reads a rating.

## Preconditions

- Signed in; for editing, `risk.matrix.manage`.

## User Flow

1. Settings → **Risk matrix** → shows version 1 (default 5×5).
2. Edits the High band to 10–15 and Critical to 16–25 → the preview grid updates → **Save as new version**.
3. A Safety Officer later rates a hazard Likely × Major = 16 → **Critical**. An event rated 16 the week before still shows **High (v1)**.

## Functional Requirements

The system shall:

1. Create the default matrix (version 1) on the company's first read, idempotently.
2. Validate a matrix on save: size 4 or 5; exactly `size` levels on each axis with labels 1–40 characters (English required, Arabic optional, O-143); bands ordered and non-overlapping, and **every possible product** of a likelihood and a consequence level falls in exactly one band (a range may skip numbers that are no product, such as 17–19 on a 5×5); 2 to 5 bands; band keys unique and taken from `low`, `medium`, `high`, `critical`. Failures → `422 RISK_MATRIX_INVALID` with the paths.
3. Store every save as a new version (`version_no` + 1); never update a version (trigger refuses `UPDATE` and `DELETE`).
4. Expose `RiskMatrixDirectory.current(companyId)` and `.version(companyId, no)` and the shared `rateRisk`; other modules never read the table (T-35).
5. Include the current matrix in the `safety-event-settings` offline pack (for the read-only "How is this rated?" view; rating itself is online, at review).

## Validation Rules

As FR-2. Required responses up to 300 characters per language.

## Permission Rules

`risk.matrix.manage` (company) to save and reset; reading the current and old versions: any user who can report or view safety events (and, from Sprint 12, risk assessments) on any project.

## Database Impact

`risk_matrix_version`: `id`, `company_id`, `version_no` (unique per company), `size`, `likelihood` (JSON levels), `consequence` (JSON levels), `bands` (JSON), `created_at`, `created_by`. The current version is the highest `version_no`.

## API Requirements

- `GET /api/v1/risk-matrix` → current version.
- `GET /api/v1/risk-matrix/versions` and `/versions/{no}`.
- `PUT /api/v1/risk-matrix` `{ size, likelihood, consequence, bands }` → the new version.
- `POST /api/v1/risk-matrix/reset` `{ size }` → a new version with the defaults.

## UI Requirements

- The grid is a table with row and column headers (likelihood × consequence) readable by screen readers; every cell shows the score and the band word.
- On phone the grid scrolls inside its card, never the page; labels wrap.
- Arabic right-to-left: likelihood axis on the start side.

## Error Handling

| Case              | Response                     |
| ----------------- | ---------------------------- |
| Invalid matrix    | `422 RISK_MATRIX_INVALID`    |
| No permission     | `403 FORBIDDEN`              |
| Read-only company | `403 SUBSCRIPTION_READ_ONLY` |

## Notifications

None.

## Audit Requirements

`risk_matrix.saved` (version number, size, bands summary), `risk_matrix.reset`.

## Acceptance Criteria

- A new company reads version 1 with the O-160 defaults.
- A matrix with a gap (no band for 12) is refused with the path of the bands.
- After saving version 2, ratings made on version 1 show their original band and the version number.
- `rateRisk` gives the same result in the web unit tests and the API for every cell of both default matrices.

## Test Scenarios

- **Positive:** default creation; save; reset to 4×4; read old version; rating snapshot unchanged after a save.
- **Negative:** gaps, overlaps, a band beyond size², too few bands, missing English labels; no permission; read-only company; update of a version refused by the trigger.

## Future Improvements

Per-project matrices; numeric-score and non-multiplicative methods (Doc 11 §12 "Numeric Score"); residual versus initial risk (Sprint 12); band-driven escalation rules.
