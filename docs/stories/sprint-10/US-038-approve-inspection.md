# US-038 — Approve Inspection

| Field    | Value                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                                   |
| Priority | Must                                                                                          |
| Status   | Approved                                                                                      |
| Sources  | Product Book Doc 10 §5, §11, §12, §18; Doc 13 §3; D-12; T-57, T-78, T-79; O-138, O-144, O-146 |

## Business Goal

Approval confirms the inspection as the record of the site's condition on that day and starts the follow-up: every confirmed finding gets an owner, a deadline and a tracked fix (Doc 10 §11–12, Doc 13 §2).

## User Story

As an **HSE Manager**, I want to approve a reviewed inspection and have the corrective actions created in the same step, so that nothing found on site is forgotten.

## Description

**Approve** opens a confirmation listing each finding with its decision: **Raise action** (responsible person and due date required) or **No action needed** (reason). Findings without a decision default to Raise action; one without a responsible person blocks approval and is highlighted.

Approving, in **one batch**: status **Approved** (`approved_at/by`); for each Raise-action finding an action through `ActionEngine.create` (type _Corrective_, title = item question, description = finding description with a link back, priority = severity, owner = responsible person, due date, place = the inspection's place, source `{ inspection, findingId }`) and the finding becomes **Action raised** with the action id; No-action findings become **No action needed**; notifications (`inspection.approved`, `action.assigned` from the engine); audit and activity. If no finding needs an action, the inspection becomes **Closed** in the same batch (O-138).

An Approved inspection is read-only except its findings panel (US-039). It closes automatically when the last finding is resolved (PLT-32 hook).

## Actors

Holders of `projects.inspections.approve` who are not the inspector. The action engine.

## Preconditions

- Submitted; online; the project accepts records **or** is On Hold (open records may be finished); not archived.
- Raise-action owners must be eligible action owners (US-053 rule: can view the project).

## User Flow

1. Inspection page → **Approve** → "Approve RMX-02-INS-0031? 3 actions will be created: …; 1 finding needs no action." → **Approve**.
2. The page shows "Approved" with the three action numbers linked under their findings.
3. With no findings: "Approve and close RMX-02-INS-0032? There are no findings." → **Approve**; status Closed.

## Functional Requirements

The system shall:

1. Approve only from Submitted, only by an eligible non-inspector, conditionally on status and version.
2. Validate every finding decision (US-039 rules); any invalid → `422 FINDING_OWNER_REQUIRED` / `VALIDATION_FAILED` with finding ids, nothing applied.
3. Create the actions with `ActionEngine.prepare`/`create` inside the approval batch; a failure in any action leaves no action, number or notification (Sprint 8 test pattern).
4. Close at once when no finding is open after approval.
5. Store `approved_on_submit` when approval happens through US-036 with "Needs approval" off.

## Validation Rules

As US-039 for findings; no extra fields on approve.

## Permission Rules

`projects.inspections.approve` (**new**), never the inspector. The approver does not need `projects.actions.create`: the inspection permission covers actions created by approval (the action's creator is recorded as the approver).

## Database Impact

`inspection.approved_at`, `approved_by`, `approved_on_submit`. Findings link to their actions through the action source (US-039); no action column on the finding.

## API Requirements

- `POST /api/v1/projects/{projectId}/inspections/{id}/transitions` `{ to: 'approve', findingChoices?: [{ findingId, decision, reason? }] }` → the inspection with findings and action numbers.

## UI Requirements

- Confirmation full screen on phone, listing findings with severity chips and owners.
- After approval, each finding shows its action number and status (`ActionDirectory.summaryForSource`).

## Error Handling

| Case                  | Response                                |
| --------------------- | --------------------------------------- |
| Self-approval         | `403 INSPECTION_SELF_APPROVAL`          |
| Finding without owner | `422 FINDING_OWNER_REQUIRED`            |
| Owner not eligible    | `422 ACTION_OWNER_NOT_ELIGIBLE`         |
| Status changed        | `409 INSPECTION_TRANSITION_NOT_ALLOWED` |
| Archived project      | `409 PROJECT_ARCHIVED`                  |
| Read-only company     | `403 SUBSCRIPTION_READ_ONLY`            |

## Notifications

`inspection.approved` (inspector), `inspection.closed` when closed at once; `action.assigned` per created action (action engine).

## Audit Requirements

`inspection.approved` (findings: raised, no action), `inspection.finding_action_raised` per action, `inspection.closed`; the engine writes `action.created` with the inspection source.

## Acceptance Criteria

- Approving with two Raise-action findings creates exactly two actions linked to their findings and the inspection; each action page shows "Source: RMX-02-INS-0031 · Finding 1".
- If one action can't be created (owner lost access), nothing is approved and the finding is named.
- An inspection without findings is Approved and Closed in one step.
- Two reviewers approving at once: one wins.

## Test Scenarios

- **Positive:** approve with actions; with No action needed only (closes); without findings (closes); approve on submit.
- **Negative:** self-approval; missing owner; ineligible owner; approve a Draft, In Progress or Approved inspection; race; archived project; read-only company; batch failure leaves nothing.

## Future Improvements

Multi-step approvals (site then HSE); approver signature; approval delegation while away.
