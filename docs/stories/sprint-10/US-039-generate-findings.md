# US-039 — Generate Findings

| Field    | Value                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                              |
| Priority | Must                                                                                     |
| Status   | Approved                                                                                 |
| Sources  | Product Book Doc 10 §2, §11, §12, §18; Doc 13 §3; T-57, T-79; O-138, O-145, O-146, O-155 |

## Business Goal

"Failed inspection items automatically create findings", and "findings become the basis for corrective actions" (Doc 10 §11). Each action "must remain linked to its originating inspection" and closing it "updates the inspection history" (§12, §18).

## User Story

As a **Safety Officer**, I want failed items to become findings automatically and to raise corrective actions from them, so that every problem found is followed up until it is fixed.

## Description

**Generation** (on submit, US-036): one finding per **Fail** item and per **Observation** with "Raise a finding" (O-145):

| Field              | Default                                                             |
| ------------------ | ------------------------------------------------------------------- |
| Description        | the item question, then the inspector's comment                     |
| Severity           | the item's priority (inspector's choice, else the template default) |
| Category           | the item's section title (both languages)                           |
| Responsible person | the item's assigned person (O-155), else empty                      |
| Due date           | inspection date + Critical 1 / High 3 / Medium 7 / Low 14 days      |
| Status             | **Open**                                                            |
| Evidence           | the item's photos (links, not copies)                               |

Findings are numbered within the inspection (Finding 1, 2 … in checklist order).

**Statuses**: **Open** → **Action raised** (an action exists and is not closed) → **Resolved** (its action closed). **No action needed** (reason) is final. A **voided** action sets its finding back to **Open** (PLT-32 hook) so another action can be raised.

**On an Approved inspection** the findings panel lets holders of `projects.actions.create` (and the approver) **Raise action** on an Open finding, or **Raise another action** on an Action-raised one (several actions per finding allowed; the finding resolves when all of them are closed), and holders of `projects.inspections.manage` mark an Open finding **No action needed** with a reason. Each action shows its number, owner, due state and status.

**Findings across inspections**: the project Inspections tab's **Open findings** count lists findings Open or Action raised with severity, inspection number, place and due date (filters: severity, place, overdue).

## Actors

The system on submit; reviewers and managers; action creators; the action engine.

## Preconditions

- Submitted (edits, US-037) or Approved (raise actions).

## User Flow

1. After approval: inspection page → **Findings** → an **Open** finding (for example one whose action was voided) → **Raise action** → owner, due date (pre-filled) → **Raise**.
2. The finding shows "Action raised · RMX-02-ACT-0107 · Due in 3 days".
3. When the action is closed after verification, the finding shows **Resolved**; when it was the last one, the inspection shows **Closed**.

## Functional Requirements

The system shall:

1. Generate findings in the submit batch, ordered by checklist position, with the defaults above.
2. Validate and save finding edits (US-037) and decisions (US-038).
3. Raise an action from a finding on an Approved inspection through `ActionEngine.create` with source `{ inspection, findingId }` in one batch; the finding becomes Action raised.
4. Implement the action source: `describe` (label `{number} · Finding {n}`, href to the inspection page anchored on the finding), `canView` (can view the inspection), `onActionChanged` (closed → resolve when all the finding's actions are closed; voided → back to Open when no other action is active; then close the inspection when every finding is Resolved or No action needed).
5. List open findings per project with filters.
6. Keep findings, their actions and evidence links for ever; findings are never deleted after approval.

## Validation Rules

| Field              | Rule                                                | Message                         |
| ------------------ | --------------------------------------------------- | ------------------------------- |
| Description        | 5–2,000                                             | "Describe the finding."         |
| Severity           | Low, Medium, High, Critical                         | —                               |
| Responsible person | Required to raise an action; can view the project   | "Choose who is responsible."    |
| Due date           | Today or later, within 1 year (action rules, O-100) | "Choose a due date from today." |
| No-action reason   | 5–500                                               | "Say why no action is needed."  |

## Permission Rules

- Edit before approval: `projects.inspections.approve` or `.manage`.
- Raise action after approval: `projects.actions.create` or `projects.inspections.approve`.
- No action needed after approval: `projects.inspections.manage`.
- See: whoever can view the inspection.

## Database Impact

`inspection_finding`: `id`, `company_id`, `project_id`, `inspection_id`, `item_key`, `seq`, `description`, `severity`, `category_en`, `category_ar`, `responsible_id`, `due_on`, `status` (`open` / `action_raised` / `resolved` / `no_action`), `no_action_reason`, `decision` (before approval), `edited_by`, `edited_at`, `resolved_at`, audit columns. Unique (`inspection_id`, `item_key`), (`inspection_id`, `seq`); index (`project_id`, `status`, `severity`). Actions are found through the action table's source index (`ActionDirectory.summaryForSource`), so there is no action column to keep in step for multiple actions.

## API Requirements

- `GET /api/v1/projects/{projectId}/inspections/{id}/findings`.
- `PATCH …/findings/{findingId}` (US-037).
- `POST …/findings/{findingId}/actions` `{ ownerId, dueOn, title?, description?, priority? }` → `201` `{ actionId, number }`.
- `POST …/findings/{findingId}/no-action` `{ reason }`.
- `GET /api/v1/projects/{projectId}/inspection-findings?status=open&severity=&placeId=&overdue=`.

## UI Requirements

- Finding cards with severity chip (icon and word), status, due state, responsible person and photos.
- "Raise action" form pre-filled and editable; the same dialog as Create action (Sprint 8) with the source shown.

## Error Handling

| Case                            | Response                                |
| ------------------------------- | --------------------------------------- |
| No responsible person           | `422 FINDING_OWNER_REQUIRED`            |
| Finding resolved or no-action   | `409 FINDING_LOCKED`                    |
| Inspection not Approved (raise) | `409 INSPECTION_TRANSITION_NOT_ALLOWED` |
| Owner not eligible              | `422 ACTION_OWNER_NOT_ELIGIBLE`         |
| Read-only company               | `403 SUBSCRIPTION_READ_ONLY`            |

## Notifications

Through the action engine (`action.assigned` etc.); `inspection.closed` when the hook closes the inspection.

## Audit Requirements

`inspection.findings_generated` (count), `inspection.finding_updated`, `inspection.finding_action_raised` (action number), `inspection.finding_no_action`, `inspection.finding_resolved`, `inspection.finding_reopened` (voided action), `inspection.closed`.

## Acceptance Criteria

- Submitting an inspection with 3 Fail items and 1 raised Observation creates 4 findings in checklist order with the defaults above.
- Closing (after verification) the only action of the last open finding closes the inspection, and its History names the action.
- Voiding an action sets its finding back to Open; a new action can be raised from it.
- Every action raised from an inspection links back to it, and the inspection lists all its actions.

## Test Scenarios

- **Positive:** generation; defaults by severity; raise after approval; several actions per finding; resolve via hook; reopen via void; open findings list.
- **Negative:** raise without owner; on a resolved or no-action finding; raising from a Submitted inspection (only edits are allowed before approval); ineligible owner; no-action without reason; read-only company; another project's finding id.

## Future Improvements

AI-suggested findings and severities (Doc 10 §19); repeat-finding detection across inspections of the same place; findings in the project risk register.
