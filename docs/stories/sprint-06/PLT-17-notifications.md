# PLT-17 — Notification Service and Notification Centre

| Field    | Value                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform enabler (Doc 31 Epic 16 — Notification Center, first part)                                                                                                 |
| Priority | Must                                                                                                                                                                |
| Status   | Approved                                                                                                                                                            |
| Sources  | Product Book Doc 01 §13, Doc 04 §13, Doc 08 §15, Doc 31; Master Rules §6 and 03 "Notification"; US-001 (deferred lock notice), PLT-09, PLT-15; T-40–T-42; O-61–O-64 |

## Business Goal

People learn about changes that affect them — a new project, a role that is about to end, a project put on hold — without checking every screen. Every later module (actions, inspections, permits) sends its notifications through this one service instead of building its own (Master Rules §6).

## User Story

As a **company user**, I want a notification bell that tells me what has changed for me and takes me straight to the record, so that I don't miss work I'm responsible for.

## Description

A bell in the header shows the number of unread notifications. Opening it shows the latest ten; each one names what happened, who did it, the project, and when. Selecting one marks it read and opens the record. **Mark all as read** and a full **Notifications** page with history complete the centre. Modules create notifications through `NotificationService` in the same database batch as the change.

## Actors

Every signed-in company user (reader); every module (sender); the daily job (reminders).

## Preconditions

- Signed in on the company's subdomain. System Owners have no notification centre in this sprint.
- The permission resolver (PLT-16) can list the users who hold a permission on a project or in the company.

## User Flow

1. A change happens (for example the user is added to project RMX-02). The bell shows **1**.
2. The user opens the bell: "Sara Ahmed added you to **RMX-02 · Riyadh Metro** as Safety Officer · 5 min ago", unread dot.
3. Selecting it marks it read and opens the project. If the user can no longer see the record, a page says "You no longer have access to this" with a link Home.
4. **Mark all as read** clears the count. **See all** opens `/notifications` with tabs **All** and **Unread**, newest first, 25 per page.

## Functional Requirements

The system shall:

1. Provide `NotificationService.entries(event)` returning statements for the caller's `UnitOfWork` (T-40), one row per recipient. `event` = `{ type, companyId, projectId?, entityType?, entityId?, actorUserId?, params, recipients }`.
2. Keep a typed **notification type registry** in code: type code, i18n key, the permission the reader needs to open the record (or none), and the target route. A type not in the registry doesn't compile.
3. Resolve recipients with helpers on the permission resolver: `usersWithProjectPermission(projectId, permission)`, `usersWithCompanyPermission(companyId, permission)`, `projectMembers(projectId)` (project roles in force plus company-wide roles), and single users. Remove the actor, duplicates and users who aren't `active` (T-41).
4. Render title and body in the **reader's language** at read time from the type's i18n key and the stored parameters (T-40). Parameters hold names as they were (for example the project code and name), so a notification still reads correctly after a rename.
5. Return the unread count for the current user (indexed count, capped display "99+").
6. List the user's notifications newest first, filter unread, page by 25 using a cursor (`before` = created time + id).
7. Mark one notification read (only the reader's own; idempotent) and mark all read (sets `read_at` on every unread row of the user, up to now).
8. **Open** a notification: mark it read, check the type's permission on the linked record now (T-41), and return the target route or `{ access: false }`.
9. Delete notifications older than **one year** in the daily job (O-63), in batches.
10. Send the events of [§ Events](#events); each sender writes the notification in the same batch as its change. Reminder-type events use `ReminderService` keys so they are sent once (PLT-09).
11. Keep notifications tenant-scoped: every query filters by `company_id` and `recipient_user_id`; ids of another user return `404`.
12. Allow the notification reads and writes in read-only mode (own account, O-36): `POST /notifications/{id}/read` and `POST /notifications/read-all` are added to the reviewed allow-list.

## Events

Proposed answer to **O-64**. "Members" = users with a project role in force on the project, plus company-wide roles (O-45). The actor is never notified.

| Type                           | When                                                                          | Recipients                                                                                                 | Opens        |
| ------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------ |
| `project.member.added`         | A project role is given to the user (US-008 or US-022)                        | The user                                                                                                   | Project      |
| `project.member.joined`        | Same event                                                                    | The project's Project Managers (project role) and holders of `projects.members.manage` with a project role | Members tab  |
| `project.member.role_changed`  | The user's project role or dates change                                       | The user                                                                                                   | Project      |
| `project.member.removed`       | The user's project role is ended                                              | The user (opens nothing: shows the project name only)                                                      | —            |
| `project.member.access_ending` | A dated project role ends in 3 days (daily job, once per assignment and date) | The user and the person who assigned it, if still active                                                   | Project      |
| `company.role.changed`         | The user's company role changes                                               | The user                                                                                                   | Profile      |
| `project.status.changed`       | Status becomes Active, On Hold or Completed                                   | Members                                                                                                    | Project      |
| `project.archived`             | Project archived                                                              | Members                                                                                                    | Project      |
| `project.restored`             | Project restored                                                              | Members                                                                                                    | Project      |
| `role.permissions.changed`     | A role's permissions are edited or reset (US-009)                             | Company Administrators                                                                                     | Role detail  |
| `user.locked`                  | An account is locked after failed sign-ins (US-001, D-05)                     | Company Administrators of that company                                                                     | User detail  |
| `subscription.reminder`        | Each existing subscription reminder email (PLT-15)                            | Company Administrators (same people as the email)                                                          | Subscription |

## Validation Rules

| Field / case      | Rule                                        | Message / result        |
| ----------------- | ------------------------------------------- | ----------------------- |
| `id`              | UUID of a notification of the current user  | `404 NOT_FOUND`         |
| `page` / `before` | Valid cursor                                | `422 VALIDATION_FAILED` |
| `params`          | At most 2 KB serialised (server-side guard) | Sender error (bug)      |

## Permission Rules

- Reading and marking: the signed-in user's own notifications only. No permission code.
- Opening: the type's permission on the linked record, checked at open time (T-41).

## Database Impact

New table `notification`:

| Column                     | Type / rule         |
| -------------------------- | ------------------- |
| `id`                       | UUID v7             |
| `company_id`               | not null            |
| `recipient_user_id`        | not null            |
| `type`                     | text, registry code |
| `params`                   | text JSON           |
| `actor_user_id`            | nullable (system)   |
| `project_id`               | nullable            |
| `entity_type`, `entity_id` | nullable            |
| `created_at`               | timestamp           |
| `read_at`                  | nullable timestamp  |

Indexes: (`recipient_user_id`, `created_at` desc), partial (`recipient_user_id`) where `read_at` is null, (`created_at`) for the purge. No audit columns beyond `created_at` (a delivery record, not a business record); not audited per row.

## API Requirements

- `GET /api/v1/notifications?unread=true&before=` → `{ items: [{ id, type, title, body, actor, projectCode, createdAt, readAt }], nextBefore }`, text already rendered in the reader's language.
- `GET /api/v1/notifications/unread-count` → `{ count }`.
- `POST /api/v1/notifications/{id}/read` → `204`.
- `POST /api/v1/notifications/read-all` → `{ marked }`.
- `GET /api/v1/notifications/{id}/open` → `{ route }` or `{ access: false }`; marks read.

## UI Requirements

- Bell icon with a badge (count, "99+"); the badge has an accessible label "{n} unread notifications". Polling per T-42.
- Panel: a sheet from the top on phone, a dropdown on desktop; ten newest; unread ones bold with a dot (never colour alone); relative times ("5 min ago") with the exact time on long press / hover in the company's date and time format.
- Empty state: "You're all caught up."
- Notifications page with All / Unread tabs and "Load more".
- Arabic right-to-left; codes and dates isolated left-to-right inside sentences (Sprint 5 lesson).

## Error Handling

| Case                        | Response                                                        |
| --------------------------- | --------------------------------------------------------------- |
| Another user's notification | `404 NOT_FOUND`                                                 |
| Record no longer accessible | `200 { access: false }` → "no access" page                      |
| Polling fails               | Badge keeps its last value; retried next minute; no error shown |

## Notifications

This item defines them.

## Audit Requirements

None per notification (delivery records). Mark-all-read is not audited. The events themselves are audited by their own stories.

## Acceptance Criteria

- Adding a user to a project creates one notification for that user and one for each of the project's Project Managers, none for the actor; the bell shows the count within a minute or on focus.
- A notification created while the user reads English shows in Arabic after they switch language.
- If the change that would cause a notification fails, no notification exists.
- A Safety Officer removed from a project who opens an older notification for it sees "You no longer have access to this".
- Mark all as read sets the count to 0; it works while the company is read-only.
- An account lock notifies every active Company Administrator of the company, not the locked user.
- A temporary project role ending on 31 Dec notifies the user and the assigner on 28 Dec, once, even if the job runs twice.
- Notifications older than one year are removed by the daily job.

## Test Scenarios

- **Positive:** each event in § Events; paging and unread filter; open with access; Arabic and English rendering; purge.
- **Negative:** another user's id; another company's id on this subdomain; open after access was removed; actor in the recipient list; suspended recipient; reminder sent twice; read-only company for every non-allow-listed route.

## Future Improvements

Email and (later) push channels per type with user preferences (Sprint 19, O-61, O-62); grouping ("3 people joined RMX-02"); notification for mentions once comments exist (Sprint 8).
