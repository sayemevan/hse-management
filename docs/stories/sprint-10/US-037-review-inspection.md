# US-037 — Review Inspection

| Field    | Value                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                                       |
| Priority | Must                                                                                              |
| Status   | Approved                                                                                          |
| Sources  | Product Book Doc 10 §5, §11, §16, §18; D-12; T-63, T-78; O-133, O-134, O-144, O-145, O-150, O-154 |

## Business Goal

A second person checks every submitted inspection before its findings become actions, so findings are accurate and evidence is sufficient (Doc 10 §5 "Under Review").

## User Story

As an **HSE Manager**, I want to open submitted inspections, check results, evidence and findings, discuss them and return an inspection to its inspector when something is wrong, so that only correct inspections are approved.

## Description

**To review** (My inspections) and the tab's **To review** count list Submitted inspections the caller may approve and didn't carry out. Opening one as a reviewer for the first time sets **Under review** (`review_started_at/by`, O-133): from then on the inspector can no longer withdraw it.

The **inspection page** shows the header, status chip, score, results by section (Fail and Observation first with a "Show all" toggle), evidence in a viewer, the **findings panel** and the **comment thread** (PLT-22). A **review bar** offers **Return to inspector** and **Approve** (US-038).

In the findings panel the reviewer can **edit each finding** before approval: description, severity, responsible person (users who can view the project), due date, decision **Raise action** / **No action needed** (reason). Edits are kept and shown with "Edited by reviewer".

**Return to inspector** with a reason → In Progress; the inspector is notified; findings are kept as they are (with the reviewer's edits) and are re-generated on the next submit by item key (edits on findings whose item still fails are kept). Items, header and new photos can then be changed; earlier photos stay (US-035).

## Actors

Holders of `projects.inspections.approve` who are not the inspector.

## Preconditions

- Submitted; online.

## User Flow

1. **My inspections** → **To review** → RMX-02-INS-0031 → the page opens, chip "Under review".
2. Findings → finding 2 → severity High → responsible "Ahmed" → due 5 Dec → **Save**.
3. Comment "Please add a photo of the corridor at level 3."
4. **Return to inspector** → reason "Photo of level 3 corridor missing." → **Return**.

## Functional Requirements

The system shall:

1. Set `review_started_at/by` on the first `POST …/review-start` by an eligible reviewer (idempotent; later reviewers don't overwrite it).
2. Allow finding edits while Submitted by approve holders (and by `projects.inspections.manage` holders), with validation as US-039.
3. Return: reason required; status In Progress; `review_started_*` cleared; findings kept; notify the inspector; audit and activity in one batch.
4. On the next submit, match findings by item key: keep edited findings whose item still fails or raises; delete those whose item no longer does; create new ones.
5. Refuse review actions to the inspector (`403 INSPECTION_SELF_APPROVAL`).
6. Register the comment target (thread on the inspection; `canComment` for viewers who are inspector, reviewer-eligible or `.manage`; locked on Closed or Cancelled).

## Validation Rules

| Field         | Rule    | Message                              |
| ------------- | ------- | ------------------------------------ |
| Return reason | 5–1,000 | "Tell the inspector what to change." |

Finding fields: see US-039.

## Permission Rules

`projects.inspections.approve` (**new**), never the inspector. Finding edits also `projects.inspections.manage`.

## Database Impact

Columns `review_started_at`, `review_started_by` (PLT-32); `inspection_finding.edited_by`, `edited_at` (US-039). Comments in the Sprint 8 `comment` table.

## API Requirements

- `POST /api/v1/projects/{projectId}/inspections/{id}/review-start` → `204`.
- `POST …/transitions` `{ to: 'return', reason }`.
- `PATCH …/findings/{findingId}` `{ description?, severity?, responsibleId?, dueOn?, decision?, reason? }`.
- `GET`, `POST …/inspections/{id}/comments` (PLT-22).

## UI Requirements

- Review bar sticky at the bottom on phone; buttons with words.
- "Edited by reviewer" chip on edited findings; changes visible in History.
- Evidence viewer with next / previous; Fail items show their photos inline.

## Error Handling

| Case                   | Response                                |
| ---------------------- | --------------------------------------- |
| Inspector reviews own  | `403 INSPECTION_SELF_APPROVAL`          |
| Not Submitted any more | `409 INSPECTION_TRANSITION_NOT_ALLOWED` |
| Read-only company      | `403 SUBSCRIPTION_READ_ONLY`            |

## Notifications

`inspection.returned` (inspector), `inspection.comment_added`, `inspection.review_waiting` (daily, PLT-32).

## Audit Requirements

`inspection.review_started`, `inspection.returned` (reason), `inspection.finding_updated` (old and new).

## Acceptance Criteria

- Opening a submitted inspection as an HSE Manager shows "Under review" and the inspector can no longer withdraw it.
- A return with a reason reaches the inspector, who can edit and resubmit; the reviewer's finding edits survive when the item still fails.
- An inspector who also holds approve can't review their own inspection.

## Test Scenarios

- **Positive:** review start once; finding edits; return; resubmit keeps matched edits and removes findings of fixed items; comments.
- **Negative:** self-review; return without reason; return a Draft or Approved inspection; comment on a Closed one; read-only company; caller without permission.

## Future Improvements

Item-level reviewer remarks; review checklists; delegating review to a named person.
