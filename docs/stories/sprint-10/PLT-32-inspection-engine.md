# PLT-32 — Inspection Engine: Model, Versions, Workflow, Numbering, Offline, Sources

| Field    | Value                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform enabler (Doc 14 Epic 05 — Inspection Engine)                                                                                                                                                                       |
| Priority | Must                                                                                                                                                                                                                        |
| Status   | Approved                                                                                                                                                                                                                    |
| Sources  | Product Book Doc 10 §1–20; Master Rules "Status Standards", "Module Independence", Rule 15; D-11, D-12, D-20; review §4 rec. 1, 4, 5; T-57, T-60, T-63, T-66–T-74; T-75–T-83; O-132–O-135, O-137, O-138, O-147, O-149–O-154 |

## Business Goal

One configurable engine runs every inspection type the company defines (Doc 10 Purpose, §20), keeps each inspection tied to the exact template version it used (§4, §18), works on site without a connection (D-11), and ends every failed item with a tracked corrective action (§11–12).

## User Story

As the **platform**, I want one inspection model, workflow and offline contract that every inspection screen and later inspection-based module uses, so that inspections are consistent, traceable and never hard-coded.

## Description

This enabler holds what US-031–039 share: the module and its tables, the **workflow definition**, the **numbering**, the **history and timeline**, **notifications** and the **daily job**, the **offline registration**, the **action source** and the **place usage**. The stories describe the screens and steps built on it.

### Records

| Record           | Holds                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template         | Company-level identity, category, status `active` / `retired`, pointer to the current published version (US-031, US-032)                                                   |
| Template version | `version_no`, `state` `draft` / `published` / `superseded`, `content` (sections → items with stable keys), allowed results, scoring, "Needs approval", "Area required"     |
| Inspection       | Project, number, pinned template version, inspector, planner, planned date, place, inspection date, weather, device location, notes, status, cancel flag, score, `version` |
| Item result      | One per answered item key: result, comment, assigned person, "raise a finding", `version`                                                                                  |
| Evidence         | Files linked to the inspection or to an item key (US-035)                                                                                                                  |
| Finding          | One per failed item or raised observation: severity, responsible person, due date, status; its actions are found through the action source (US-039)                        |

### Workflow (T-78, D-12, O-133, O-134)

`INSPECTION_WORKFLOW` in `packages/shared/src/inspections/workflow.ts`:

| From               | Transition | To                      | Who                                                           | Guards                                                                                                    |
| ------------------ | ---------- | ----------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| —                  | plan       | Draft                   | `projects.inspections.manage`                                 | project accepts records (O-50); template active; inspector can conduct on the project                     |
| —                  | start ⚡   | In Progress             | `projects.inspections.conduct` (the caller becomes inspector) | as plan; version allowed (O-147); "Area required" met                                                     |
| Draft              | start ⚡   | In Progress             | the inspector                                                 | —                                                                                                         |
| Draft, In Progress | reassign   | (same)                  | `projects.inspections.manage`                                 | new inspector can conduct; not offline                                                                    |
| Draft, In Progress | cancel     | (same) + Cancelled flag | `.manage`, or the inspector for an unplanned one              | reason 5–500 characters                                                                                   |
| In Progress        | submit ⚡  | Submitted               | the inspector                                                 | every item answered, evidence rules met (US-036); if "Needs approval" is off → Approved in the same batch |
| Submitted          | withdraw   | In Progress             | the inspector                                                 | no reviewer has opened it (`review_started_at` null)                                                      |
| Submitted          | return     | In Progress             | `projects.inspections.approve`, not the inspector             | reason 5–1,000 characters                                                                                 |
| Submitted          | approve    | Approved                | `projects.inspections.approve`, not the inspector             | each finding decided (US-038); actions created in the batch                                               |
| Approved           | (system)   | Closed                  | the action hook / approve                                     | every finding Resolved or No action needed (O-138)                                                        |

Every transition is a conditional update on (`status`, `version`): two people acting at once → the second gets `409 INSPECTION_TRANSITION_NOT_ALLOWED`. Approved, Closed and Cancelled inspections are read-only (`409 INSPECTION_LOCKED`) except finding actions on Approved ones (US-039). The project must accept records for plan and start; an inspection already open on a project put **On Hold** can still be completed, submitted and reviewed (the Sprint 8 rule for actions). Archived project → everything read-only (O-53).

### Numbering (T-82)

`withRecordNumber(uow, projectId, 'INS')` when the inspection is created on the server. A planned inspection gets its number at once; one started offline gets it on sync (the device shows "Not yet synced"). Cancelled inspections keep their number.

### History and timeline

`GET …/inspections/{id}/history` returns the inspection's activity entries (`entity_type = inspection`, T-56): planned, started (with `offline` and `capturedAt`), header changes (old and new), result saves grouped per request (item keys and results), evidence added or removed, each transition with reason, findings edited, actions raised, closed. The same entries appear on the **project timeline** under a new **Inspections** group.

### Notifications (O-150)

| Type                        | When                                  | Recipients                                                                                                        |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `inspection.assigned`       | planned; reassigned                   | the inspector                                                                                                     |
| `inspection.unassigned`     | reassigned                            | the previous inspector                                                                                            |
| `inspection.submitted`      | submitted with "Needs approval"       | approve holders on the project who aren't the inspector; company-wide roles only if no project member can approve |
| `inspection.returned`       | returned                              | the inspector (with the reason excerpt)                                                                           |
| `inspection.approved`       | approved                              | the inspector                                                                                                     |
| `inspection.closed`         | closed                                | the inspector and the approver                                                                                    |
| `inspection.cancelled`      | cancelled by someone else             | the inspector                                                                                                     |
| `inspection.overdue`        | daily job, first overdue day          | the inspector and the planner                                                                                     |
| `inspection.review_waiting` | daily job, submitted more than 2 days | the same audience as `submitted` (one digest per person and day)                                                  |
| `inspection.comment_added`  | new comment                           | inspector, approver and commenters, except the author                                                             |

Parameters: `inspectionNumber`, `templateName` (both languages, T-80), `projectCode`, `plannedOn`, `count`, `reason` excerpt. Recipients must still be able to view the inspection (T-41). The actor never notifies themselves.

### Daily job

`inspections.due`, per company after midnight in its time zone (T-64): `inspection.overdue` (key `inspection:{id}:overdue:{plannedOn}`; a new planned date gives a new key) and `inspection.review_waiting` (key `inspection-review:{userId}:{date}`).

### Offline (T-80, O-147)

API: `POST /projects/{projectId}/inspections` (start), `PATCH …/{id}`, `PUT …/{id}/items/{itemKey}`, `POST …/{id}/files` and the `start` / `submit` transitions use `idempotent()`, accept a device `id` on create and `baseVersion` on updates, and call `SyncConflictService.detect` on a mismatch. Two `SyncEntity` registrations in `modules/inspection/index.ts`:

| Entity            | Version on       | `conflictFields`                                  |
| ----------------- | ---------------- | ------------------------------------------------- |
| `inspection`      | the header       | `placeId`, `inspectedOn`, `weather`, `notes`      |
| `inspection_item` | each item result | `result`, `comment`, `assignedTo`, `raiseFinding` |

A `submit` sent with an old header version is **not a conflict**: submit has no fields; it is refused with `INSPECTION_TRANSITION_NOT_ALLOWED` if the status moved on (e.g. reassigned or cancelled), and the item goes to Needs attention with the reason.

Web: `registerOfflineEntity` for both types in `offline-modules.ts`, reference pack `inspection-templates` (published versions of active templates plus versions superseded in the last 7 days, ETag), and the offline routes **My inspections**, **Start** and **Capture**. Labels are `{ key: 'inspections.outbox.label', params: { templateName: {en, ar}, number? } }`.

### Action source (T-79)

```ts
registerActionSource({
  module: 'inspection',
  describe(companyId, findingId) → { label: 'RMX-02-INS-0012 · Finding 2', href, projectId } | null,
  canView(principal, findingId) → boolean,      // can view the inspection
  onActionChanged(uow, { actionId, status, voided }) → void,   // new hook
});
```

The action engine calls `onActionChanged` inside its own batch when an action of the source is **closed** or **voided**. The finding becomes **Resolved** (closed) or back to **Open** (voided, the action link kept in history); when every finding of an Approved inspection is resolved, the inspection becomes **Closed** in the same batch. Sprint 8's `manual` and `action` sources implement nothing.

### Places

`PlaceUsage` registration: a place used by any inspection (cancelled included) can't be deleted (T-39). A template's "Area required" makes `placeId` with at least the Area level required at start (`422 PLACE_REQUIRED`). Inactive places are not offered but stay on old inspections.

## Actors

All roles through the stories; the action engine through the hook; the daily job; the sync engine.

## Preconditions

- The module's migrations are applied; the five permissions are seeded with their defaults (O-149).

## Functional Requirements

The system shall:

1. Store templates, versions, inspections, item results, files and findings as in the Data model (overview), scoped by `company_id`, with project-scoped rows carrying `project_id`.
2. Apply every status change only through `INSPECTION_WORKFLOW`, conditionally on status and version, writing audit, activity and notification statements in the same `UnitOfWork`.
3. Number inspections per project with T-60 on server creation.
4. Never change a published template version; read an inspection's questions only from its pinned version (Doc 10 §18).
5. Expose `InspectionDirectory.summaryForProject(projectId)` (counts for the tab and later dashboards) and register the action source, the place usage, the comment target and both sync entities in `index.ts`.
6. Accept offline writes as described, replaying duplicates (T-69) and detecting conflicts per item (T-70).
7. Run the daily job `inspections.due`.
8. Refuse every write for a read-only company (T-24) and list each route in `test/lifecycle.test.ts`.
9. Show only inspections the caller may see: all of the project with `projects.inspections.view`, otherwise their own (inspector or planner).

## Validation Rules

See each story. Shared: ids are UUIDs; a device id already used for another record → `409 RECORD_ID_TAKEN`; `capturedAt` handled as O-129.

## Permission Rules

As O-149. Company-wide roles act in every project (O-45). The server re-checks every permission when offline items sync (T-73). Self-approval is refused even for holders of every permission (`INSPECTION_SELF_APPROVAL`).

## Database Impact

`inspection` (core columns):

| Column                                                                                                            | Type / rule                                               |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `id`, `company_id`, `project_id`                                                                                  | UUID v7 or device id; not null                            |
| `number`                                                                                                          | text, unique per project                                  |
| `template_id`, `template_version_id`                                                                              | FK, not null                                              |
| `status`                                                                                                          | `draft`, `in_progress`, `submitted`, `approved`, `closed` |
| `cancelled_at`, `cancelled_by`, `cancel_reason`                                                                   | nullable                                                  |
| `inspector_id`, `planned_by`, `planned_on`                                                                        | `planned_*` null for on-the-spot inspections              |
| `area_id`, `location_id`, `work_zone_id`                                                                          | nullable (`PlaceDirectory.resolve`)                       |
| `inspected_on`, `weather`, `notes`                                                                                | date; enum or null; text ≤ 2,000                          |
| `latitude`, `longitude`, `location_accuracy_m`                                                                    | nullable (O-148)                                          |
| `started_at`, `submitted_at`, `review_started_at`, `review_started_by`, `approved_at`, `approved_by`, `closed_at` | nullable                                                  |
| `score_percent`, `score_outcome`                                                                                  | nullable; `pass` / `fail` / null                          |
| `follow_up_of`                                                                                                    | FK `inspection`, nullable (O-134)                         |
| `captured_at`, `received_at`, `offline`                                                                           | as O-129                                                  |
| `version`                                                                                                         | integer, starts at 1 (T-70)                               |
| audit columns                                                                                                     | `created_at/by`, `updated_at/by`                          |

Indexes: (`project_id`, `status`, `planned_on`); (`company_id`, `inspector_id`, `status`); (`project_id`, `template_id`); (`area_id`), (`location_id`), (`work_zone_id`) for `PlaceUsage`. Other tables are in their stories.

## API Requirements

See the overview's API table. Every inspection route is under `/projects/{projectId}/inspections` (T-45); a record of another project in the URL → `404`.

## UI Requirements

- Status chip with icon and text (never colour alone); "Cancelled", "Under review", "Overdue · n days" and "Not yet synced" as separate chips.
- Codes, numbers and dates in `<bdi dir="ltr">`; Arabic right-to-left; cards at every width; dialogs full-screen on phone.

## Error Handling

| Case                                   | Response                                |
| -------------------------------------- | --------------------------------------- |
| Transition not allowed now             | `409 INSPECTION_TRANSITION_NOT_ALLOWED` |
| Write on Approved, Closed or Cancelled | `409 INSPECTION_LOCKED`                 |
| Caller is not the inspector            | `403 INSPECTION_NOT_INSPECTOR`          |
| Approver is the inspector              | `403 INSPECTION_SELF_APPROVAL`          |
| Project doesn't accept records         | `409 PROJECT_NOT_ACCEPTING_RECORDS`     |
| Archived project                       | `409 PROJECT_ARCHIVED`                  |
| Read-only company                      | `403 SUBSCRIPTION_READ_ONLY`            |
| Stale offline version                  | `409 SYNC_CONFLICT`                     |

## Notifications

See the table above.

## Audit Requirements

`inspection.planned`, `inspection.started`, `inspection.updated` (old and new), `inspection.items_saved` (keys and results), `inspection.file_added`, `inspection.file_removed`, `inspection.submitted`, `inspection.withdrawn`, `inspection.returned`, `inspection.approved`, `inspection.closed`, `inspection.cancelled`, `inspection.reassigned`, `inspection.finding_updated`, `inspection.finding_action_raised`. Offline metadata as O-130; replays write nothing.

## Acceptance Criteria

- Each of the six Doc 10 §18 business rules holds in an integration test.
- An inspection started offline and synced twice exists once, with one number and one `inspection.started` entry carrying `offline: true`.
- Two reviewers approving at once: one succeeds, the other is told it changed.
- Closing the last action of an approved inspection closes it; the History shows the action number that closed it.
- A place used by a cancelled inspection can't be deleted.

## Test Scenarios

- **Positive:** every transition of the table; numbering in order across planned and synced inspections; history and timeline entries; daily job keys; hook from close and void.
- **Negative:** every guard; another company's or project's ids; read-only company; offline write after reassignment; self-approval; superseded version outside the window.

## Future Improvements

Multi-step approval chains; recurring schedules; co-inspectors; per-project default templates; equipment inspections (Doc 25) reusing the engine with an asset link; QR-code start; digital signatures; PDF report (Q-33).
