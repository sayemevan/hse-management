# US-036 — Submit Inspection

| Field    | Value                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                                              |
| Priority | Must                                                                                                     |
| Status   | Approved                                                                                                 |
| Sources  | Product Book Doc 14, Doc 10 §5, §11, §13, §18; D-11, D-12; T-78, T-81; O-134, O-139, O-140, O-144, O-145 |

## Business Goal

Submitting hands the inspection over for review and fixes its content: "Submitted inspections cannot be edited without reopening" (Doc 10 §18).

## User Story

As an **Inspector**, I want to check that nothing is missing and submit the inspection, even offline, so that it is reviewed and its findings are followed up.

## Description

**Review and submit** opens a sheet listing what still blocks submission — unanswered items, Fail or Not inspected items without a comment, items whose photo is required but missing (O-139), a required Area — each linking to the item. When nothing blocks, the sheet shows the result summary (counts per result), the **score** and outcome, and the **findings** that will be created (every Fail, and Observations with "Raise a finding", O-145).

**Submit** (offline-capable) moves the inspection to **Submitted** and freezes it; findings are created with their proposed severity, responsible person and due date. Offline, the submit is queued after every item and photo of the inspection; the inspection shows "Submitted · Not yet synced" and can't be edited on the device.

If the template's **Needs approval** is off (O-144), the sheet also shows each finding's choice (**Raise action** / **No action needed** with reason) as in US-038, and submitting **approves** the inspection in the same batch (online only for that step: offline, the submit is queued and the approval happens on arrival with the choices made).

**Withdraw** (online): until a reviewer opens it, the inspector can take a Submitted inspection back to In Progress (findings are removed again; they are re-created on the next submit).

## Actors

The inspector.

## Preconditions

- In Progress; caller is the inspector.

## User Flow

1. Capture → **Review and submit** → "2 items need attention" → tap → fix → back.
2. "Ready to submit: 28 Pass, 3 Fail, 1 Not applicable · Score 88 % — Pass · 3 findings will be created" → **Submit**.
3. Confirmation "Submitted. The reviewers have been told." (offline: "Submitted on this device. It will be sent when you're back online.")
4. Later: inspection page → **Withdraw** → "Take this inspection back to edit it?" → **Withdraw**.

## Functional Requirements

The system shall:

1. Check completeness on the server with the pinned version: every item has a result; Fail and Not inspected have a comment; photo rules; Area rule. Failures → `422 INSPECTION_INCOMPLETE` with item keys and reasons (`INSPECTION_EVIDENCE_REQUIRED` per item).
2. Count photos only when **uploaded**: an offline submit waits on its photo uploads (`dependsOn`); if a photo is still missing, the submit is refused and goes to Needs attention with the item named.
3. In one batch: status Submitted, `submitted_at`, score (`scoreInspection`) stored, findings created (US-039), `inspection.submitted` notifications, audit, activity.
4. With "Needs approval" off: also apply the approval of US-038 with the inspector's choices, recorded as "Approved on submit".
5. Withdraw: only the inspector, only while `review_started_at` is null; findings deleted in the batch (they have no actions yet).
6. Lock items, header and files of a Submitted inspection (`409 INSPECTION_LOCKED`).

## Validation Rules

As FR-1. Withdraw: none. "No action needed" reason (approval off): 5–500.

## Permission Rules

The inspector with `projects.inspections.conduct`.

## Database Impact

`inspection.submit_count` (integer) and the columns of PLT-32; findings in US-039.

## API Requirements

- `POST /api/v1/projects/{projectId}/inspections/{id}/transitions` ⚡ `{ to: 'submit', findingChoices?: [{ itemKey, decision, reason? }] }` → the inspection with score and findings.
- `POST …/transitions` `{ to: 'withdraw' }`.
- `GET …/inspections/{id}/readiness` → the blocking list (also computed on the device).

## UI Requirements

- The readiness list grouped by section, each line with an icon and words.
- Score with outcome word ("Pass" / "Fail"), never colour alone.
- After submit the capture screen becomes the read-only inspection page.

## Error Handling

| Case                        | Response                                |
| --------------------------- | --------------------------------------- |
| Missing answers / comments  | `422 INSPECTION_INCOMPLETE`             |
| Missing required photo      | `422 INSPECTION_EVIDENCE_REQUIRED`      |
| Already submitted / changed | `409 INSPECTION_TRANSITION_NOT_ALLOWED` |
| Withdraw after review began | `409 INSPECTION_TRANSITION_NOT_ALLOWED` |
| Not the inspector           | `403 INSPECTION_NOT_INSPECTOR`          |
| Read-only company           | `403 SUBSCRIPTION_READ_ONLY`            |

## Notifications

`inspection.submitted` to reviewers (O-150); none when approval is off (`inspection.approved` is not sent to oneself).

## Audit Requirements

`inspection.submitted` (score, outcome, finding count, submit count, offline metadata), `inspection.withdrawn`.

## Acceptance Criteria

- Submit with an unanswered item is refused and the item is named; with all answered it succeeds and the stored score equals the device's.
- A submit queued offline before its photos are uploaded arrives after them and succeeds.
- After submit, saving an item answers `INSPECTION_LOCKED`.
- Withdraw works until a reviewer opens the inspection, then is refused.

## Test Scenarios

- **Positive:** submit with approval on and off; withdraw; offline submit ordering after uploads; score stored.
- **Negative:** each completeness rule; double submit (replay returns the same result; a new key → transition not allowed); withdraw after review started; not the inspector; read-only company.

## Future Improvements

Inspector signature on submit (Q-24); a summary emailed to the planner.
