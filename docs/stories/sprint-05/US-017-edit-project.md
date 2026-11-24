# US-017 — Edit Project and Change Status

| Field    | Value                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Epic     | Epic 03 — Project Management                                            |
| Priority | Must                                                                    |
| Status   | Approved                                                                |
| Sources  | Product Book Doc 14, Doc 06 §9, Doc 08 §5–6, §12; D-13; T-36; O-49–O-51 |

## Business Goal

Project details and status stay true to the site: dates move, clients change names, work stops and restarts. The status decides whether new safety records can be raised (O-50).

## User Story

As a **Project Manager** (or Company Administrator / HSE Director), I want to keep my project's details and status up to date, so that everyone records work against the right project and nobody raises records on a stopped site.

## Description

The project page has **Edit** (details) and **Change status** (next allowed statuses only, with an optional note). Holding returns the project to where it was; completing can be undone by reopening.

## Actors

Holders of `projects.edit` and `projects.status.change` on the project (default: Company Administrator, HSE Director, the project's Project Manager).

## Preconditions

- Signed in, with the permission on that project (PLT-16).
- The project isn't archived (US-018) and the company isn't read-only.

## User Flow

**Edit details**

1. Project page → **Edit**. The form of US-016 opens with current values (code read-only unless the status is Planning, O-51).
2. **Save**. The page shows the new values.

**Change status**

1. Project page → **Change status**. Only the allowed next statuses are offered, each with a one-line meaning ("Active — work in progress; safety records can be raised").
2. Optional note (up to 500 characters). **Confirm**.

## Functional Requirements

The system shall:

1. Update any US-016 field except the status, with the same validation; `code` only while the status is `planning`.
2. Allow these status changes and refuse all others (O-49):

   | From         | To                                                        |
   | ------------ | --------------------------------------------------------- |
   | Planning     | Mobilization, Active                                      |
   | Mobilization | Active, On Hold                                           |
   | Active       | On Hold, Completed                                        |
   | On Hold      | the status it was put on hold from (`status_before_hold`) |
   | Completed    | Active (reopen)                                           |

3. Record `status_before_hold` when holding, clear it when resuming; set `status_changed_at` on each change.
4. Use optimistic concurrency (`updated_at` sent back as `version`) for edits and status changes; a stale version is refused.
5. Refuse every change on an archived project (`PROJECT_ARCHIVED`).
6. Not touch project roles on any status change (US-008 FR-8).

## Validation Rules

As US-016 for the fields, plus:

| Field   | Rule                           | Message                                                                |
| ------- | ------------------------------ | ---------------------------------------------------------------------- |
| Code    | Changed only in Planning       | "The code can't be changed once the project has started."              |
| Status  | Allowed by the table above     | "A project can't move from {from} to {to}."                            |
| Note    | Optional, up to 500 characters | "The note is too long."                                                |
| Version | Matches                        | "This project was changed by someone else. Reload to see the changes." |

## Permission Rules

`projects.edit` for details; `projects.status.change` for status (project scope). Edit and Change status buttons are shown only with the matching entry in `myPermissions`.

## Database Impact

Updates `project` (US-016 columns). No new table.

## API Requirements

- `PATCH /api/v1/projects/{id}` `{ version, …fields }` → `200`.
- `POST /api/v1/projects/{id}/status` `{ version, status, note? }` → `200`.
- `GET /api/v1/projects/{id}` adds `allowedNextStatuses[]` (empty without `projects.status.change`).

## UI Requirements

- Status change as a bottom sheet on phone with radio options; the current status is shown at the top.
- The project page shows "Safety records can be raised" or "No new safety records while {status}" from `acceptsRecords`.

## Error Handling

| Case                | Response                        |
| ------------------- | ------------------------------- |
| Not allowed change  | `409 INVALID_STATUS_TRANSITION` |
| Code after Planning | `409 PROJECT_CODE_LOCKED`       |
| Code taken          | `409 PROJECT_CODE_TAKEN`        |
| Archived            | `409 PROJECT_ARCHIVED`          |
| Stale version       | `409 CONFLICT`                  |
| Read-only company   | `403 SUBSCRIPTION_READ_ONLY`    |

## Notifications

None in this sprint (Sprint 6 adds "Project Activated" and status notices, Doc 08 §15).

## Audit Requirements

`project.updated` with changed fields before and after; `project.status.changed` with from, to and note.

## Acceptance Criteria

- A Project Manager of Project A can edit A and change its status; on Project B (no role) they get `404`.
- A Site Engineer on Project A sees no Edit or Change status button, and the API refuses them.
- Active → On Hold → resume returns to Active; Mobilization → On Hold → resume returns to Mobilization.
- Planning → Completed is refused with the message naming both statuses.
- The code is editable in Planning and locked after the project moves on.
- Two people editing at once: the second save is refused, nothing is lost.

## Test Scenarios

- **Positive:** every allowed transition; edit each field; reopen a completed project.
- **Negative:** every disallowed transition (table-driven); archived project; stale version; code after Planning; read-only mode; caller without permission.

## Future Improvements

Reason codes for On Hold; automatic reminders when the expected completion date passes (Sprint 19); project timeline view (Sprint 6).
