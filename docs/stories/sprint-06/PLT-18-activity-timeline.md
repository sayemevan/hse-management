# PLT-18 — Activity Timeline Service and Project Timeline

| Field    | Value                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform enabler                                                                                                             |
| Priority | Must                                                                                                                         |
| Status   | Approved                                                                                                                     |
| Sources  | Product Book Doc 04 §12, Doc 08 §12, Doc 31 (Activity Center, rule 4); Master Rules 03 "Activity Timeline"; T-43, T-44; O-65 |

## Business Goal

Everyone responsible for a project can see its history — who created it, who joined, which areas were set up, when it was put on hold — in plain language. Every later record (inspection, permit, action) gets the same timeline from the same service.

## User Story

As a **Project Manager or HSE Manager**, I want a timeline of everything that happened in my project, with who changed what from what to what, so that I can answer "when did this change and who did it?" without asking the administrator.

## Description

The project's **Timeline** tab lists events newest first, grouped by day: an icon, a sentence ("Omar Khaled changed the status from Active to On Hold"), the time, and for edits a "Show changes" list of fields with old and new values. A filter narrows it to Project, Members or Structure events. Entries can't be edited or deleted by anyone (Doc 31 rule 4).

## Actors

Holders of `projects.timeline.view`; every module (writer).

## Preconditions

- The project exists in the request's company; the user holds `projects.timeline.view` on it (O-65).

## User Flow

1. Open a project → **Timeline**.
2. Scroll; older entries load in pages of 50.
3. Choose a filter chip (**All**, **Project**, **Members**, **Structure**).
4. Select **Show changes** on an edit to see `Field: old → new`.

## Functional Requirements

The system shall:

1. Provide `ActivityService.entry(event)` returning a statement for the caller's `UnitOfWork` (T-43). `event` = `{ action, companyId, projectId?, entityType, entityId, actorUserId, changes?, snapshot? }`, where `changes` = `[{ field, old, new }]` and `snapshot` holds names shown in the sentence (project code and name, place name and level, member name, role).
2. Keep a typed **activity action registry** (code, i18n key, filter group, the permission needed to see it). An action not in the registry doesn't compile.
3. Make `activity_entry` immutable: database triggers reject UPDATE and DELETE (as `0001_audit_log_immutable`).
4. Write entries for the project actions of Sprint 5 and this sprint: project created, details edited (changed fields only), status changed, archived, restored; member added, role or dates changed, removed, access ended by date (written by the daily job on the day after Until); place created, renamed or edited, moved, deactivated, reactivated, deleted.
5. Record changes for edits only, never secrets; long text fields (description) record "changed" without values over 500 characters.
6. List a project's entries newest first, page by 50 with a cursor, filter by group; render sentences in the reader's language at read time.
7. Hide entries whose action needs a permission the reader lacks on the project (for example member entries need `projects.members.view`, O-66).
8. Back-fill Sprint 5 projects once by migration from `audit_log` (T-44), mapping each audit action to its activity action and copying actor, time, and the old and new values the audit entry holds.
9. Show the actor's current name; if the user was later removed from the company, show the name with "(former user)".

## Validation Rules

| Field / case | Rule                     | Message / result        |
| ------------ | ------------------------ | ----------------------- |
| `type`       | One of the filter groups | `422 VALIDATION_FAILED` |
| `before`     | Valid cursor             | `422 VALIDATION_FAILED` |

## Permission Rules

- `projects.timeline.view` (project scope, new) to see the tab and the API; member entries also need `projects.members.view`.

Proposed defaults (O-65), project scope: CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE ✓, SV —, FM —, IN —, WK —, CL —, CO —, AU ✓. Company-editable.

## Database Impact

New table `activity_entry`:

| Column                     | Type / rule                               |
| -------------------------- | ----------------------------------------- |
| `id`                       | UUID v7                                   |
| `company_id`               | not null                                  |
| `project_id`               | nullable (company-level activities later) |
| `entity_type`, `entity_id` | not null                                  |
| `action`                   | text, registry code                       |
| `actor_user_id`            | nullable (system)                         |
| `changes`                  | text JSON, nullable                       |
| `snapshot`                 | text JSON, nullable                       |
| `occurred_at`              | timestamp                                 |

Indexes: (`project_id`, `occurred_at` desc), (`entity_type`, `entity_id`, `occurred_at` desc). Triggers rejecting UPDATE and DELETE. Documented exception to the audit columns, like `audit_log`.

## API Requirements

- `GET /api/v1/projects/{projectId}/timeline?type=members&before=` → `{ items: [{ id, action, group, sentence, actor, occurredAt, changes: [{ field, label, old, new }] }], nextBefore }`.

## UI Requirements

- Timeline tab on the project page (PLT-19), visible only with the permission.
- Day headers in the company's date format ("Today", "Yesterday" for the last two days); times in the company's time format.
- Icons by group plus text (never icon alone); "Show changes" expands inline.
- Empty state: "Nothing has happened in this project yet."
- Arabic right-to-left; codes and values isolated left-to-right inside sentences.

## Error Handling

| Case                            | Response                      |
| ------------------------------- | ----------------------------- |
| No `projects.view`              | `404 NOT_FOUND` (PLT-16 FR-8) |
| View but no timeline permission | `403 FORBIDDEN`               |

## Notifications

None.

## Audit Requirements

None extra: the actions themselves are audited by their stories. The back-fill migration is logged in the migration notes.

## Acceptance Criteria

- Changing a project's name and city writes one entry showing both fields with old and new values.
- An UPDATE or DELETE on `activity_entry` fails in the local database.
- A Supervisor (no timeline permission) gets `403`; a Safety Officer sees project and structure entries but member entries only if `projects.members.view` is granted (it is by default, O-66).
- A project created in Sprint 5 shows its creation and status changes after the migration.
- Entries created in English read in Arabic after a language switch.

## Test Scenarios

- **Positive:** each action in FR-4; filter groups; paging; back-fill; former-user names.
- **Negative:** another company's project; missing permission; trigger rejections; a change that fails writes no entry.

## Future Improvements

Timelines on records (inspections, permits, actions) from Sprint 8; company-wide Activity Center (Sprint 19, Doc 31); export of a timeline with reports (Sprint 18).
