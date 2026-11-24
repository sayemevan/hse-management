# US-018 — Archive and Restore Project

| Field    | Value                                                                    |
| -------- | ------------------------------------------------------------------------ |
| Epic     | Epic 03 — Project Management                                             |
| Priority | Must                                                                     |
| Status   | Approved                                                                 |
| Sources  | Product Book Doc 14, Doc 06 §13, Doc 08 §6; D-13, D-18, D-27; O-52, O-53 |

## Business Goal

Finished or cancelled projects get out of everyone's way and free a place on the plan, while their history stays available for audits and legal needs (Doc 06 §13: never deleted).

## User Story

As a **Company Administrator**, I want to archive a project we no longer work on, and restore it if needed, so that daily lists stay short and our records are kept.

## Description

The project page has **Archive** (with a confirmation that names the project). An archived project is read-only for everyone, hidden from the default list and shown under the **Archived** filter with an "Archived on … by …" line. **Restore** brings it back to the status it had, if the plan's project limit allows.

## Actors

Holders of `projects.archive` (default: Company Administrator).

## Preconditions

- Signed in with `projects.archive` on the project; company not read-only.
- Restore: the project limit allows one more non-archived project (O-52).

## User Flow

**Archive**

1. Project page → **Archive project**.
2. The dialog explains: "Archived projects can't be changed and don't accept new records. Nothing is deleted. You can restore it later." The user types the project code to confirm.
3. **Archive**. The page shows the Archived banner; edit and status actions disappear.

**Restore**

1. Projects → filter **Archived** → open the project → **Restore**.
2. Confirm. The project returns to its previous status.

## Functional Requirements

The system shall:

1. Archive from any status (O-53): set `status_before_archive` to the current status (for On Hold, keep `status_before_hold` too), status `archived`, `archived_at`, `archived_by`.
2. Make an archived project read-only: every project write (US-017, US-008 new project roles) returns `PROJECT_ARCHIVED`. Later modules get this through `acceptsRecords` = false (US-016 FR-8).
3. Keep the project visible to everyone who had `projects.view` on it, under the Archived filter.
4. Restore: check `PlanLimitService` first (T-29), then set the status back to `status_before_archive` and clear the archive fields.
5. Not change project roles on archive or restore.
6. Never delete a project or its rows.

## Validation Rules

| Field        | Rule                                         | Message                                                              |
| ------------ | -------------------------------------------- | -------------------------------------------------------------------- |
| Confirmation | Typed code equals the project code (UI only) | "Type {code} to confirm."                                            |
| State        | Archive: not archived; restore: archived     | "This project is already archived." / "This project isn't archived." |

## Permission Rules

`projects.archive` (project scope) for both actions.

## Database Impact

Uses the US-016 columns; no new table.

## API Requirements

- `POST /api/v1/projects/{id}/archive` `{ version }` → `200`.
- `POST /api/v1/projects/{id}/restore` `{ version }` → `200`.

## UI Requirements

- Archived banner in dark grey at the top of the project page with date and name of who archived it; actions other than Restore hidden.
- Destructive-style Archive button, separated from the other actions.

## Error Handling

| Case                            | Response                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Already archived / not archived | `409 INVALID_STATUS_TRANSITION`                                                                    |
| Limit on restore                | `409 PLAN_LIMIT_REACHED`: "Your plan allows {limit} projects. Archive another project or upgrade." |
| Stale version                   | `409 CONFLICT`                                                                                     |
| Read-only company               | `403 SUBSCRIPTION_READ_ONLY`                                                                       |

## Notifications

None in this sprint (Doc 08 §15 "Project Archived" in Sprint 6).

## Audit Requirements

`project.archived` and `project.restored`, each with the status before and after.

## Acceptance Criteria

- On Basic, archiving the only project lets the administrator create a new one; restoring the archived one is then refused with the limit message.
- An archived project can be opened and read, but not edited, moved or given new project roles (API refuses all of them).
- Restoring an archived On Hold project returns it to On Hold, still remembering what to resume to.
- A Project Manager can't archive by default; after the company grants `projects.archive` to Project Manager (US-009) they can.

## Test Scenarios

- **Positive:** archive from each status; restore to each status; archived filter.
- **Negative:** archive twice; restore a non-archived project; limit on restore; write attempts on an archived project; read-only mode; caller without permission.

## Future Improvements

Exporting an archived project's records as one bundle (Sprints 17–18); retention rules (Sprint 19).
