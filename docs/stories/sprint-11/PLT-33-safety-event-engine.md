# PLT-33 — Safety Event Engine: Model, Types, Workflow, Numbering, Visibility, Offline, Jobs

| Field    | Value                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform enabler (Doc 14 Epic 06 — Safety Event Engine; Doc 20)                                                                                                                                                                        |
| Priority | Must                                                                                                                                                                                                                                   |
| Status   | Approved                                                                                                                                                                                                                               |
| Sources  | Product Book Doc 11 §1–19, Doc 20; Master Rules "Module Independence", "Master Data", Rule 15; D-11, D-20; review §4 rec. 4, 5; T-57, T-60, T-63, T-66–T-74, T-78–T-80; T-84–T-93; O-156–O-158, O-161, O-163–O-168, O-175, O-177–O-182 |

## Business Goal

One configurable engine records every safety occurrence (Doc 11 Purpose, §2), routes it through review, investigation, corrective action and closure with a complete history (§7, §17), works where the signal is worst (D-11), and keeps injury details away from people who don't need them.

## User Story

As the **platform**, I want one safety event model, workflow, visibility rule and offline contract that every reporting, investigation and closure screen uses, so that hazards, near misses and incidents are handled consistently and never as separate systems.

## Description

This enabler holds what US-040–046 share: the module and its tables, **event types and categories**, the **workflow definition**, **numbering**, **visibility** (T-93), **history and timeline**, **notifications** and the **daily job**, the **offline registration**, the **action source**, the **comment target** and the **place usage**. The stories describe the screens and steps built on it; the risk matrix is PLT-34.

### Records

| Record         | Holds                                                                                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event type     | Company list: name (en, ar), family `hazard` / `near_miss` / `incident`, investigation rule, minimum severity, injury details on/off, Area required, risk rating at review required/optional, active, sort order (O-164)                                                                                  |
| Event category | Company list: name (en, ar), active, sort order (O-165)                                                                                                                                                                                                                                                   |
| Event          | Project, number, type (and its family at report time), 1–3 categories, title, description, occurred at, place, device location, reported and confirmed severity, risk snapshot, immediate action taken, damage and environmental details, status, voided flag, review, closure, follow-up link, `version` |
| Person         | Injured or involved people of an incident (US-042, sensitive)                                                                                                                                                                                                                                             |
| Witness        | Name or link, company, contact, statement (US-045)                                                                                                                                                                                                                                                        |
| Investigation  | Lead, team, due date, sequence of events, causes, recommendations, lessons learned (US-043, US-044)                                                                                                                                                                                                       |
| Recommendation | Kind, description, status; its actions are found through the action source (T-89)                                                                                                                                                                                                                         |
| Evidence       | Files linked to the event, a person or a witness (US-040, US-042, US-045)                                                                                                                                                                                                                                 |

### Type rules (T-85, O-164)

| Rule                  | Values                                | Effect                                                                                                    |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Family                | `hazard`, `near_miss`, `incident`     | Form sections (US-040–042); fixed once the type is used                                                   |
| Investigation         | `required`, `by_severity`, `optional` | O-159: `required` always; `by_severity` when the confirmed severity is High or Critical; `optional` never |
| Minimum severity      | none, Low … Critical                  | Reported and confirmed severity can't be lower (`422 SAFETY_EVENT_SEVERITY_BELOW_MINIMUM`)                |
| Injury details        | on / off                              | Shows the People section with injury fields (US-042)                                                      |
| Area required         | on / off (default off)                | `422 PLACE_REQUIRED` without at least an Area                                                             |
| Risk rating at review | `required` / `optional`               | `422 RISK_RATING_REQUIRED` at the review decision                                                         |

A rule change applies to events **reviewed** after it; an event keeps the family it was reported with unless the reviewer changes its type. A deactivated type is not offered; offline reports made on it within the 7-day window (O-118) are accepted.

### Workflow (T-86, O-157)

`SAFETY_EVENT_WORKFLOW` in `packages/shared/src/safety-events/workflow.ts`:

| From                                             | Transition                 | To                                                    | Who                                                       | Guards                                                                                                                          |
| ------------------------------------------------ | -------------------------- | ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| —                                                | report ⚡                  | Reported                                              | `projects.safety_events.report` (caller becomes reporter) | project accepts records or is On Hold (O-181); type active or within the window; time rule (O-177); minimum severity; Area rule |
| Reported                                         | assign                     | Under Investigation                                   | `projects.safety_events.manage`                           | classification complete (US-043); lead eligible (O-170)                                                                         |
| Reported                                         | act                        | Corrective Action                                     | `.manage`                                                 | classification complete; investigation **not** required; ≥ 1 immediate action raised in the batch                               |
| Reported                                         | close                      | Closed                                                | `projects.safety_events.close`                            | classification complete; investigation not required; "No further action" reason (US-046)                                        |
| Under Investigation                              | reassign                   | (same)                                                | `.manage`                                                 | new lead eligible; reason                                                                                                       |
| Under Investigation                              | complete_investigation     | Corrective Action, or Verification if nothing is open | the lead investigator                                     | O-171 content complete; every recommendation has an action raised or "No action needed"                                         |
| Corrective Action                                | (system)                   | Verification                                          | the action hook (T-89)                                    | every recommendation Resolved or No action needed                                                                               |
| Verification                                     | (system) new action raised | Corrective Action                                     | the action raise                                          | —                                                                                                                               |
| Verification                                     | return                     | Under Investigation                                   | `.close`, not the lead                                    | reason 5–1,000; only for investigated events                                                                                    |
| Verification                                     | close                      | Closed                                                | `.close`, not the lead of an investigated event           | closure summary (O-174)                                                                                                         |
| Reported, Under Investigation, Corrective Action | void                       | (same) + Voided flag                                  | `.manage`                                                 | no open action; reason (O-179)                                                                                                  |

Every transition is a conditional update on (`status`, `version`): two people acting at once → the second gets `409 SAFETY_EVENT_TRANSITION_NOT_ALLOWED`. **"Investigation cannot begin until the event is reported"** (Doc 11 §17) holds because events exist on the server only as Reported. Closed and Voided events are read-only (`409 SAFETY_EVENT_LOCKED`). Archived project → everything read-only (O-53). An event already open on a project put On Hold can still be reviewed, investigated and closed; only new actions wait (O-181).

### Numbering (T-91)

`withRecordNumber(uow, projectId, 'EVT')` when the report reaches the server (online at once, offline on sync; the device shows "Not yet synced"). One sequence for every type; voided events keep their number.

### Visibility (T-93)

| Audience  | Who                                                   | Sees                                                                                                       |
| --------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Reporter  | the user who reported                                 | Own report, files, status, confirmed type and severity, closure summary; edits until review starts (O-167) |
| Viewer    | `projects.safety_events.view`                         | Everything except people's details, sensitive files, witness contacts and statements                       |
| Team      | lead investigator and team members, while on the team | Everything, edits the investigation and witnesses                                                          |
| Manager   | `.manage`                                             | As viewer plus witness contacts and statements; classification, assignment, actions, void                  |
| Closer    | `.close`                                              | As manager for reading; close and return                                                                   |
| Sensitive | `projects.safety_events.sensitive.view`               | People's details and sensitive files                                                                       |

`safetyEventAccess(principal, event)` returns these flags; every route, list query, the action source `canView`, the comment target and notification audiences use it. A list filters in SQL to `project` rows when the caller is a viewer, otherwise to `reported_by = caller` or team membership.

### History and timeline

`GET …/safety-events/{id}/history` returns the event's activity entries (`entity_type = safety_event`, T-56): reported (with `offline` and `capturedAt`), reporter edits (old and new), review started, classification changes (old and new, risk snapshot), each transition with reason, investigation assigned / reassigned / team changed, causes and recommendations changed (grouped per request), actions raised, witnesses added / changed, files added / removed, closed. Entries about **people and sensitive files** carry `sensitive: true` and are shown only to the Team and Sensitive audiences. The same entries appear on the **project timeline** under a new **Safety events** group.

### Tab and My reports

Project **Safety events** tab (needs `.view`; reporters without it are sent to My reports): counts **Open**, **Critical and High open**, **To review**, **Overdue investigations**, **Awaiting closure** (Verification); filters status, type, family, severity, risk band, place, overdue, "Show voided"; cards with number, type, title, severity chip, risk band chip, status chip, place, occurred date, "Reported late" chip. `SafetyEventDirectory.summaryForProject(projectId)` serves the counts (and later dashboards).

**My reports** (`/safety-events`, offline): tabs **Reported by me** (also queued reports from the outbox, "Not yet synced"), **Investigating** (lead or team), **To review** (Reported events on projects where the caller holds `.manage`), **To close** (Verification on projects with `.close`). Online it keeps the user's last 20 reports on the device so the tab works offline.

### Notifications (O-175)

| Type                                    | When                                      | Recipients                                                                                          |
| --------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `safety_event.reported`                 | report arrives (Low, Medium)              | `.manage` holders on the project; company-wide roles only if no project member can review           |
| `safety_event.high_reported`            | report arrives or severity raised to High | as above plus every HSE Director and HSE Manager of the company                                     |
| `safety_event.critical_reported`        | Critical, or type Fatality                | as High plus Company Administrators; urgent flag (top of the list, red chip with the word "Urgent") |
| `safety_event.investigation_assigned`   | assigned; reassigned; added to team       | the lead / the member                                                                               |
| `safety_event.investigation_unassigned` | removed as lead or member                 | that person                                                                                         |
| `safety_event.investigation_completed`  | investigation completed                   | the reviewer and `.close` holders who aren't the lead                                               |
| `safety_event.verification_ready`       | last action closed                        | `.close` holders on the project who aren't the lead                                                 |
| `safety_event.returned`                 | returned                                  | the lead (with reason excerpt)                                                                      |
| `safety_event.closed`                   | closed                                    | reporter, lead                                                                                      |
| `safety_event.voided`                   | voided                                    | reporter                                                                                            |
| `safety_event.investigation_overdue`    | daily job                                 | lead and reviewer, once                                                                             |
| `safety_event.review_waiting`           | daily job, Reported over 1 day            | `.manage` holders (one digest per person and day)                                                   |
| `safety_event.comment_added`            | new comment                               | reporter, lead, team and commenters, except the author                                              |

Parameters: `eventNumber`, `typeName` (both languages), `title` excerpt, `projectCode`, `severity`, `dueOn`, `count`, `reason` excerpt — **never people's names or injury details**. Recipients must still be able to view the event (T-41). The actor never notifies themselves. The severity notifications are written in the same batch as the report on arrival, so "immediate" means the moment the report reaches the server.

### Daily job

`safety_events.due`, per company after midnight in its time zone (T-64): `safety_event.investigation_overdue` (key `safety-event:{id}:investigation-overdue:{dueOn}`; sent if the job runs within 3 days of the due date) and `safety_event.review_waiting` (key `safety-event-review:{userId}:{date}`).

### Offline (T-90, O-163)

API: `POST /projects/{projectId}/safety-events` (report), `PATCH …/{id}` (reporter fields only, offline) and `POST …/{id}/files` use `idempotent()`, accept a device `id` on create and `baseVersion` on updates, and call `SyncConflictService.detect` on a mismatch. One `SyncEntity` in `modules/safety-event/index.ts`:

| Entity         | Version on | `conflictFields`                                                                                                |
| -------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `safety_event` | the header | `title`, `description`, `occurredAt`, `placeId`, `reportedSeverity`, `immediateAction`, `typeId`, `categoryIds` |

A reporter's offline edit that arrives **after a reviewer opened the event** is refused with `409 SAFETY_EVENT_LOCKED` (Needs attention: "A reviewer has started reviewing this report. Add what you wanted to say as a comment."), not a conflict. Photos that arrive after review started are still accepted when they were **captured before** `review_started_at` (`capturedAt`), so a slow upload never loses evidence.

Web: `registerOfflineEntity({ type: 'safety_event', … })` in `offline-modules.ts`, the pack `safety-event-settings` (types with rules, categories, severity guidance; ETag over list versions only), the offline routes `/safety-events` and `/safety-events/report`. Every change of a report (create, edits, photos) uses the event id as `entityId`. `baseVersion` is sent only when the device knows the server version and nothing for the event is still queued. Labels are `{ kind: 'safety_event', en, ar, ref }` (type name in both languages, title excerpt, number when known).

### Action source (T-89)

```ts
registerActionSource({
  module: 'safety_event',
  describe(db, companyId, recommendationId) → { label: 'RMX-02-EVT-0007 · Recommendation 2', href, projectId } | null,
  canView(db, principal, recommendationId) → boolean,   // safetyEventAccess: viewer, team or manager (not the reporter alone)
  onActionChanged({ actionId, status, voided, recordId }) → Statement[],
});
```

Closed action → the recommendation becomes **Resolved** when it has no other open action; voided action → the recommendation goes back to **Open** (history keeps the link). When every recommendation of a Corrective Action event is Resolved or No action needed, the event moves to **Verification** in the same batch; a recommendation re-opened on a Verification event moves it back to Corrective Action. Actions are created with `ActionEngine.prepare` and one `peekNumber()` per batch (Sprint 10 refinement); a due date already past becomes today; an On Hold project refuses new actions (`PROJECT_NOT_ACCEPTING_RECORDS`). The **reporter is not given access to the action** by being the reporter.

### Places

`PlaceUsage` registration: a place used by any event (voided included) can't be deleted (T-39). Inactive places are not offered but stay on old events.

## Actors

All roles through the stories; the action engine through the hook; the daily job; the sync engine.

## Preconditions

- The module's migrations are applied; the eight permissions are seeded with their defaults (O-168); the company's types, categories, cause lists and matrix are seeded on first use.

## Functional Requirements

The system shall:

1. Store types, categories, events and their child records as in the Data model (overview), scoped by `company_id`, with project-scoped rows carrying `project_id`.
2. Seed the ten types, eleven categories and both cause lists in English and Arabic on the company's first use of the module (idempotent).
3. Apply every status change only through `SAFETY_EVENT_WORKFLOW`, conditionally on status and version, writing audit, activity and notification statements in the same `UnitOfWork`.
4. Number events per project with T-60 on server creation.
5. Evaluate "investigation required" with one shared function `investigationRequired(typeRule, severity)` used by the web (to show the right decision buttons) and the server (to enforce it).
6. Enforce visibility with `safetyEventAccess` on every read and write, and strip people, sensitive files, witness contacts and statements, and sensitive history from responses for audiences without them.
7. Expose `SafetyEventDirectory.summaryForProject(projectId)` and register the action source, the place usage, the comment target and the sync entity in `index.ts`.
8. Accept offline writes as described, replaying duplicates (T-69) and detecting conflicts on the header (T-70).
9. Run the daily job `safety_events.due`.
10. Refuse every write for a read-only company (T-24) and list each route in `test/lifecycle.test.ts`.
11. Never delete an event or its child records; removals are soft (files) or edits recorded in history (Doc 11 §17).

## Validation Rules

See each story. Shared: ids are UUIDs; a device id already used for another record → `409 RECORD_ID_TAKEN`; `capturedAt` handled as O-129; type and category names 2–80 characters, unique per company across both languages (`LIST_ITEM_NAME_TAKEN`); up to 50 types and 50 categories.

## Permission Rules

As O-168. Company-wide roles act in every project (O-45). The server re-checks every permission when offline items sync (T-73). Self-closure of an investigated event is refused even for holders of every permission (`SAFETY_EVENT_SELF_CLOSURE`), except company-wide roles when no one else on the project can close (recorded as "Closed by the investigator — no other closer").

## Database Impact

`safety_event` (core columns):

| Column                                                                                                                  | Type / rule                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `id`, `company_id`, `project_id`                                                                                        | UUID v7 or device id; not null                                                   |
| `number`                                                                                                                | integer, unique per project                                                      |
| `type_id`, `family`                                                                                                     | FK; family copied at report and on type change                                   |
| `title`, `description`                                                                                                  | text 5–120; text 10–4,000                                                        |
| `occurred_at`, `reported_late`                                                                                          | timestamp; boolean (O-177)                                                       |
| `area_id`, `location_id`, `work_zone_id`                                                                                | nullable (`PlaceDirectory.resolve`)                                              |
| `latitude`, `longitude`, `location_accuracy_m`                                                                          | nullable (O-148)                                                                 |
| `reported_by`, `reported_severity`, `severity`                                                                          | `severity` null until reviewed                                                   |
| `immediate_action`, `potential_outcome`, `damage_details`, `environment_details`                                        | text, nullable (US-040–042)                                                      |
| `risk_matrix_version`, `risk_likelihood`, `risk_consequence`, `risk_score`, `risk_band`, `risk_band_label` (JSON en/ar) | nullable snapshot (T-87)                                                         |
| `status`                                                                                                                | `reported`, `under_investigation`, `corrective_action`, `verification`, `closed` |
| `investigation_required`                                                                                                | boolean, fixed at the review decision, re-evaluated when severity rises          |
| `review_started_at/by`, `reviewed_at/by`, `review_note`, `self_reviewed`                                                | nullable                                                                         |
| `voided_at/by`, `void_reason`, `void_kind`, `duplicate_of`                                                              | nullable                                                                         |
| `closed_at/by`, `closure_kind` (`no_further_action` / `completed`), `closure_summary`                                   | nullable                                                                         |
| `follow_up_of`                                                                                                          | FK `safety_event`, nullable (O-158)                                              |
| `captured_at`, `received_at`, `offline`                                                                                 | as O-129                                                                         |
| `version`                                                                                                               | integer, starts at 1 (T-70)                                                      |
| audit columns                                                                                                           | `created_at/by`, `updated_at/by`                                                 |

Indexes: (`project_id`, `status`, `severity`); (`company_id`, `reported_by`, `status`); (`project_id`, `type_id`); (`area_id`), (`location_id`), (`work_zone_id`) for `PlaceUsage`. A trigger refuses `DELETE` on `safety_event` and its child tables. Other tables are in their stories.

## API Requirements

See the overview's API table. Every event route is under `/projects/{projectId}/safety-events` (T-45); a record of another project in the URL → `404`. An event the caller may not see → `404` (not `403`), so its existence doesn't leak.

## UI Requirements

- Status chip with icon and text (never colour alone); "Voided", "Under review", "Overdue · n days", "Reported late", "Not yet synced", "Urgent" as separate chips. Severity and risk band chips always carry the word.
- Codes, numbers, dates and times in `<bdi dir="ltr">`; Arabic right-to-left; cards at every width; dialogs full-screen on phone.
- The **Report** button is reachable in one tap from the home page and the project page (a floating button on phone).

## Error Handling

| Case                                  | Response                                  |
| ------------------------------------- | ----------------------------------------- |
| Transition not allowed now            | `409 SAFETY_EVENT_TRANSITION_NOT_ALLOWED` |
| Write on Closed or Voided             | `409 SAFETY_EVENT_LOCKED`                 |
| Investigation required but skipped    | `409 SAFETY_EVENT_INVESTIGATION_REQUIRED` |
| Investigated event closed by its lead | `403 SAFETY_EVENT_SELF_CLOSURE`           |
| Project doesn't accept records        | `409 PROJECT_NOT_ACCEPTING_RECORDS`       |
| Archived project                      | `409 PROJECT_ARCHIVED`                    |
| Event not visible to the caller       | `404 NOT_FOUND`                           |
| Read-only company                     | `403 SUBSCRIPTION_READ_ONLY`              |
| Stale offline version                 | `409 SYNC_CONFLICT`                       |

## Notifications

See the table above.

## Audit Requirements

`safety_event.reported`, `safety_event.updated` (old and new), `safety_event.review_started`, `safety_event.classified` (old and new, risk snapshot), `safety_event.investigation_assigned`, `safety_event.investigation_reassigned`, `safety_event.team_changed`, `safety_event.investigation_updated`, `safety_event.investigation_completed`, `safety_event.returned`, `safety_event.action_raised`, `safety_event.recommendation_no_action`, `safety_event.verification_ready`, `safety_event.closed`, `safety_event.addendum_action_raised`, `safety_event.voided`, `safety_event.file_added`, `safety_event.file_removed`, `safety_event.person_changed` (no injury text in the audit summary), `safety_event.witness_changed`, settings changes (`safety_event_type.*`, `safety_event_category.*`, `safety_cause_category.*`). Offline metadata as O-130; replays write nothing.

## Acceptance Criteria

- Each of the Doc 11 §17 and Doc 20 business rules holds in an integration test.
- A report made offline and synced twice exists once, with one number and one `safety_event.reported` entry carrying `offline: true`.
- A Critical report sends `safety_event.critical_reported` to the project's managers, HSE Directors, HSE Managers and Company Administrators in the batch that stores it.
- A Client viewing an incident sees "1 person injured" and no names, injury details or medical files; the history has no entry about them.
- A place used by a voided event can't be deleted; a `DELETE` on `safety_event` is refused by the database.

## Test Scenarios

- **Positive:** every transition of the table; numbering in order across online and synced reports; history and timeline entries with sensitive filtering; daily job keys; action hook from close and void; settings seed is idempotent.
- **Negative:** every guard; another company's or project's ids; an event invisible to the caller → 404; read-only company; offline reporter edit after review started; self-closure; required investigation skipped.

## Future Improvements

Configurable investigation templates; custom severity labels; anonymous or confidential reporting; events raised from inspection findings and permits; regulatory notifications and LTI frequency rates; email and push for critical events (Q-27); PDF report (Q-33); dashboards (Doc 30).
