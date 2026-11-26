# PLT-23 — Action Engine: Model, Sources, Workflow, Due State, Reminders

| Field    | Value                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 08 — Action Management (Doc 13, Doc 22)                                                                                                                                              |
| Priority | Must                                                                                                                                                                                      |
| Status   | Approved                                                                                                                                                                                  |
| Sources  | Product Book Doc 13 §1–18, Doc 22; Master Rules "Module Independence", "Status lists"; D-12; review C-05, C-13, §4 rec. 1 and 4; T-57–T-65; O-96–O-101, O-106, O-107, O-109, O-111, O-112 |

## Business Goal

One action engine for the whole platform, so that a finding from an inspection, a hazard report or a permit review is followed up the same way, tracked in one place and never lost (Doc 13 Purpose, §2, §18).

## User Story

As a **safety team**, we want every follow-up task in one consistent engine with an owner, a deadline and a fixed workflow, so that nothing identified on site is forgotten.

## Description

This enabler holds what US-053–058 share: the `action` record, the **source registry** later modules plug into, the **workflow definition**, the **due state**, **voiding**, the action's **History**, the **notifications** and the daily **reminder job**. The stories describe the screens and steps built on it.

### The action record

| Field              | Rule                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Number             | `{project code}-ACT-{0001}` from `RecordNumbers` (T-60, O-98); read-only                                                                  |
| Project            | Required; the action never moves to another project                                                                                       |
| Source             | `source_module` (`manual`, `action`, later `inspection`, `safety_event`, `permit`, …), `source_record_id`, `source_label` snapshot (T-57) |
| Type               | One of six (O-99): `corrective`, `preventive`, `improvement`, `observation_follow_up`, `recommendation`, `compliance`                     |
| Title, description | Title 5–150 characters; description up to 4,000                                                                                           |
| Priority           | `low`, `medium`, `high`, `critical` (O-100)                                                                                               |
| Owner              | One user (O-101); collaborators up to 5 (O-102)                                                                                           |
| Due date           | Required date (O-100)                                                                                                                     |
| Place              | Optional `area_id`, `location_id`, `work_zone_id` from `PlaceDirectory` (O-112)                                                           |
| Status             | `open`, `in_progress`, `completed`, `verified`, `closed` (D-12, O-96)                                                                     |
| Voided             | `voided_at`, `voided_by`, `void_reason` (O-106)                                                                                           |
| Milestones         | `started_at`, `completed_at`, `verified_at`, `verified_by`, `closed_at`, `closed_by` (for Sprint 18 reports: average closure time)        |

### Workflow (T-58)

`ACTION_WORKFLOW` in the shared package. "Participant" = owner or collaborator of this action.

| From          | To            | Name             | Who                                                    | Requires                                               |
| ------------- | ------------- | ---------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `open`        | `in_progress` | Start            | owner                                                  | —                                                      |
| `open`        | `completed`   | Complete         | owner                                                  | completion note; evidence for High / Critical (O-103)  |
| `in_progress` | `completed`   | Complete         | owner                                                  | as above                                               |
| `completed`   | `verified`    | Verify           | `projects.actions.verify`, not a participant (O-104)   | method; note optional; evidence optional               |
| `completed`   | `in_progress` | Send back        | `projects.actions.verify`, not a participant           | reason 10–2,000 characters                             |
| `verified`    | `closed`      | Close            | `projects.actions.close`                               | note optional                                          |
| `completed`   | `closed`      | Verify and close | holds both verify and close, not a participant (O-105) | as Verify; writes two updates and two timeline entries |

No other move exists: no reopening a closed action (O-97), no going back from Verified. Every transition checks the action's current status in the same statement (`UPDATE … WHERE status = ?`), so two people pressing at once can't both succeed: the second gets `409 ACTION_TRANSITION_NOT_ALLOWED` with the current status.

### Due state (T-59)

`actionDueState(dueOn, status, today)`:

| State       | When                                    | Shown as                           |
| ----------- | --------------------------------------- | ---------------------------------- |
| `done`      | status is Completed, Verified or Closed | no due badge                       |
| `overdue`   | `dueOn < today`                         | "Overdue · 3 days" (icon and text) |
| `due_today` | `dueOn = today`                         | "Due today"                        |
| `due_soon`  | `today < dueOn ≤ today + 3`             | "Due in 2 days"                    |
| `on_track`  | later                                   | the date                           |

`today` is the calendar date in the company's time zone. A Completed action that is sent back is measured against its due date again.

### Sources (T-57)

```ts
registerActionSource({
  module: 'inspection',
  describe(companyId, recordId) → { label, href, projectId } | null,
  canView(principal, recordId) → boolean,       // may narrow who sees these actions
});

ActionEngine.create(uow, {
  projectId, source: { module, recordId }, type, title, description,
  priority, ownerId, dueOn, place?, collaboratorIds?, createdBy,
}) → { id, number }
```

`create` applies every US-053 rule (eligible owner, project accepts records, due date), writes the audit, timeline and notification statements into the caller's `uow` and returns the number. The `source_label` is taken from `describe` when the action is created and **kept** (the source record may change later; the link uses `href`). An action whose source can no longer be described shows the label with "Source no longer available".

Sprint 8 sources: `manual` (no record, label "Manual"), `action` (follow-up of a closed action, label = the closed action's number; the closed action shows "Follow-up: RMX-02-ACT-0057").

### Void (O-106)

`POST …/void { reason }` on an Open or In Progress action by `projects.actions.manage`. Sets the void columns in a conditional update, writes an `action_update` of kind `void`, removes the action from lists unless `voided=true`, stops reminders, notifies the owner. A voided action is read-only (`409 ACTION_LOCKED` on every write).

### History

`GET …/history` returns the action's activity entries (T-56 `listForEntity`, `entity_type = action`): created, every field change with old and new value, owner and collaborator changes, each transition, file added, void. The same entries appear on the **project timeline** under a new **Actions** group. Comments are not timeline entries (they are in the thread).

### Notifications

New types in `NOTIFICATION_TYPES` (O-109). Recipients are users who can view the action at that moment (T-41, T-65); the actor never notifies themselves.

| Type                         | When                                              | Recipients                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action.assigned`            | created; owner changed                            | the new owner                                                                                                                                                                            |
| `action.unassigned`          | owner changed                                     | the previous owner                                                                                                                                                                       |
| `action.collaborator_added`  | collaborator added                                | that collaborator                                                                                                                                                                        |
| `action.due_tomorrow`        | daily job, day before due                         | owner                                                                                                                                                                                    |
| `action.overdue`             | daily job, first overdue day                      | owner; for High / Critical also the creator                                                                                                                                              |
| `action.due_digest`          | daily job, owner has due-today or overdue actions | owner (counts; Critical overdue listed every day)                                                                                                                                        |
| `action.verification_needed` | completed                                         | the creator if they hold verify and aren't a participant; otherwise every project member with verify who isn't a participant, excluding company-wide roles unless no one else can verify |
| `action.sent_back`           | sent back                                         | owner and collaborators                                                                                                                                                                  |
| `action.verified`            | verified                                          | owner and creator                                                                                                                                                                        |
| `action.closed`              | closed                                            | owner, collaborators and creator                                                                                                                                                         |
| `action.voided`              | voided                                            | owner and collaborators                                                                                                                                                                  |
| `action.due_date_changed`    | due date changed                                  | owner and collaborators                                                                                                                                                                  |
| `action.comment_added`       | new comment (PLT-22)                              | owner, collaborators and creator, except the author                                                                                                                                      |
| `action.owner_lost_access`   | owner can no longer view the project              | project members with `projects.actions.manage` (once per action and owner)                                                                                                               |

Parameters: `actionNumber`, `actionTitle` (first 80 characters), `projectCode`, `priority`, `dueOn`, `count`/`overdue`/`dueToday` for the digest, `reason` excerpt for send-back. Each opens the action page; the digest opens **My actions** filtered to due today and overdue.

### Reminder job (T-64)

`actions.due`, daily, per company after midnight in the company's time zone. For each non-voided action in Open or In Progress: send `action.due_tomorrow` (key `action:{id}:due:{dueOn}:-1`), `action.overdue` (key `…:overdue:{dueOn}`). A changed due date produces new keys, so the reminders follow it. Then one `action.due_digest` per owner (key `action-digest:{userId}:{date}`). The job also checks owners' access and sends `action.owner_lost_access` once (key `action:{id}:owner-lost:{ownerId}`).

## Actors

All roles through the stories; later modules through `ActionEngine`; the daily job.

## Preconditions

- The company has the `action` module's migrations; the five permissions are seeded (O-107).

## Functional Requirements

The system shall:

1. Store actions as described above, one table for every source (T-57).
2. Expose `ActionEngine.create`, `registerActionSource` and `ActionDirectory.summaryForSource(module, recordIds)` (counts by status for a source record, for later modules' screens) in the module's `index.ts`.
3. Check every status change against `ACTION_WORKFLOW` and the action's current status in one conditional statement (T-58).
4. Compute the due state with `actionDueState` in the company's time zone (T-59).
5. Give each action the next project number in the same batch (T-60).
6. Enforce the view rule of T-65 on every read, list, file and comment route; return `404` (not `403`) for an action the caller may not see.
7. Allow voiding as described (O-106) and block every write on a locked action (`ACTION_LOCKED`).
8. Refuse new actions on projects that don't accept records (`409 PROJECT_NOT_ACCEPTING_RECORDS`) and every write on archived projects (`409 PROJECT_ARCHIVED`) (O-111).
9. Register the action module as a `PlaceUsage` so a place used by any action (voided included) can't be deleted (O-112).
10. Write the audit entry, the activity entry and the notifications in the same batch as each change.
11. Run `actions.due` as described, idempotent per reminder key.
12. Seed the five permissions with their default rows (O-107), `sort_order` following the catalogue.

## Validation Rules

See US-053 (fields), US-054 (owner, collaborators), US-055–058 (notes, evidence, reasons). Void reason: 10–500 characters ("Give a reason of at least 10 characters.").

## Permission Rules

New project-scope permissions, company-editable (O-107):

| Permission                | CA  | HD  | HM  | PM       | SO  | SE  | SV  | FM  | IN  | WK  | CL  | CO  | AU  |
| ------------------------- | --- | --- | --- | -------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `projects.actions.view`   | ✓   | ✓   | ✓   | ✓        | ✓   | ✓   | ✓   | ✓   | ✓   | —   | ✓   | ✓   | ✓   |
| `projects.actions.create` | ✓   | ✓   | ✓   | ✓        | ✓   | ✓   | ✓   | ✓   | ✓   | —   | —   | —   | —   |
| `projects.actions.manage` | ✓   | ✓   | ✓   | ✓        | ✓   | —   | —   | —   | —   | —   | —   | —   | —   |
| `projects.actions.verify` | ✓   | ✓   | ✓   | ✓ (D-54) | ✓   | —   | —   | —   | —   | —   | —   | —   | —   |
| `projects.actions.close`  | ✓   | ✓   | ✓   | ✓        | ✓   | —   | —   | —   | —   | —   | —   | —   | —   |

Participants (owner, collaborators, creator) with `projects.view` see their own actions without `projects.actions.view` (T-65). Owner and collaborator rights come from the role on the action, not from a permission.

## Database Impact

New table `action`:

| Column                                              | Type / rule                                        |
| --------------------------------------------------- | -------------------------------------------------- |
| `id`                                                | UUID v7                                            |
| `company_id`, `project_id`                          | not null; FK `project`                             |
| `number`                                            | integer, not null; unique (`project_id`, `number`) |
| `source_module`, `source_record_id`, `source_label` | text; `source_record_id` null for `manual`         |
| `type`, `priority`, `status`                        | text, checked against the shared lists             |
| `title`, `description`                              | text                                               |
| `owner_id`, `created_by`                            | FK `user`                                          |
| `due_on`                                            | date text `YYYY-MM-DD`                             |
| `area_id`, `location_id`, `work_zone_id`            | nullable, FK `place`                               |
| milestone columns                                   | nullable (see above)                               |
| `voided_at`, `voided_by`, `void_reason`             | nullable                                           |
| audit columns                                       | `created_at`, `updated_at`, `updated_by`           |

Indexes: (`project_id`, `status`, `due_on`); (`company_id`, `owner_id`, `status`, `due_on`); (`project_id`, `source_module`, `source_record_id`); (`area_id`), (`location_id`), (`work_zone_id`) for `PlaceUsage`.

New table `record_counter` (`project` module, T-60): `project_id`, `kind`, `next_value`; primary key (`project_id`, `kind`).

`action_owner_history`, `action_collaborator`, `action_update`, `action_file`: see US-054–056. Triggers on `action_update` reject UPDATE and DELETE.

## API Requirements

- `POST …/actions/{actionId}/void { reason }` → the action.
- `GET …/actions/{actionId}/history?before=` → `{ entries, nextCursor }` (T-56 format).
- Every action response includes `number` (formatted), `dueState`, `allowedTransitions` (names the caller may use now, from T-58) and `can` (`edit`, `reassign`, `void`, `comment`, `addEvidence`) so the web app shows only valid controls.

## UI Requirements

- Status chips with icon and text, never colour alone: Open, In Progress, Completed ("Waiting for verification"), Verified, Closed; Voided with a strike-through title and "Voided" chip.
- Due badges as in the due-state table; overdue shows an icon and the number of days.
- History tab on the action page with the timeline sentences (T-40 pattern, translated in the web app).
- Arabic right-to-left; numbers and codes in `<bdi dir="ltr">`.

## Error Handling

| Case                                      | Response                                               |
| ----------------------------------------- | ------------------------------------------------------ |
| Move not in the workflow / status changed | `409 ACTION_TRANSITION_NOT_ALLOWED` (+ current status) |
| Write on a closed or voided action        | `409 ACTION_LOCKED`                                    |
| New action on a project not accepting     | `409 PROJECT_NOT_ACCEPTING_RECORDS`                    |
| Archived project                          | `409 PROJECT_ARCHIVED`                                 |
| Action not visible to the caller          | `404 NOT_FOUND`                                        |
| Read-only company                         | `403 SUBSCRIPTION_READ_ONLY`                           |

## Notifications

See § Notifications above.

## Audit Requirements

`action.created`, `action.updated` (old and new), `action.owner_changed`, `action.collaborator_added`, `action.collaborator_removed`, `action.progress_added`, `action.file_added`, `action.started`, `action.completed`, `action.verified`, `action.sent_back`, `action.closed`, `action.voided`. Matching timeline actions in a new `actions` group.

## Acceptance Criteria

- An action created by hand records source `manual`; a follow-up of a closed action records the closed action as source and both pages link to each other.
- A test-only source registered in the test suite creates an action through `ActionEngine.create` inside its own batch; when the batch fails, no action, number, notification or timeline entry remains.
- Only the moves in the workflow table succeed, for exactly the actors listed.
- An action due yesterday shows "Overdue · 1 day" in the company's time zone, even when the server's UTC date is still the due date.
- The owner gets "due tomorrow" once, "overdue" once and the digest once a day, across repeated job runs; a Critical overdue action stays in the digest every day until completed.
- A voided action disappears from lists, stops reminders and refuses every write.
- An area used by an action can't be deleted.

## Test Scenarios

- **Positive:** create through the engine; each transition; Verify and close; void; history; reminders at each threshold; due-date change moving the reminders.
- **Negative:** every move outside the workflow; concurrent transitions; verifier who is the owner or a collaborator; writes on closed and voided actions; projects in Planning, On Hold (create refused, progress allowed), Completed, Archived; another company's or project's action id; read-only company.

## Future Improvements

SLA targets per priority and escalation (Doc 13 §17); multi-level approvals using the same workflow format; QR-code site verification; company-defined types (O-99); offline updates (Sprint 9).
