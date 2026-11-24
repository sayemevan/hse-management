# US-008 — Role Assignment

| Field    | Value                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security                                                                   |
| Priority | Must                                                                                                  |
| Status   | Approved                                                                                              |
| Sources  | Product Book Doc 14, Doc 07 §8, §12, §16; Doc 08 §9–10; D-02, D-08; O-23, O-24; T-33, T-34; O-45–O-48 |

## Business Goal

People's access matches their actual job: a user can change responsibility without a new account, hold different roles on different projects, and outside parties get access that ends on its own.

## User Story

As a **Company Administrator**, I want to change a user's company role and give them roles on specific projects, with dates where needed, so that each person can do exactly their job on each site.

## Description

The user detail page shows the user's company role and a list of project roles. The administrator can change the company role, add a project role (project, role, optional start and end dates), change or end it. Every change takes effect on the user's next request and is audited.

## Actors

Company Administrator (holder of `users.roles.assign`); the affected user.

## Preconditions

- Signed in on the company's subdomain with `users.roles.assign` (PLT-16).
- The company isn't read-only (D-18, T-24).
- The target user belongs to the same company and isn't `archived`. Pending invitations can have their company role changed (the role applies once they accept).

## User Flow

**Change the company role**

1. **Settings → Users**, select a user. The detail page shows name, email, status, **Company role** and **Project roles**.
2. Select **Change** next to the company role, choose a role, confirm. The page shows the new role.

**Add a project role**

1. On the user detail page select **Add to project**.
2. Choose a project (active, planning, mobilization, on-hold or completed; not archived), a role (O-47 list), and optional **From** and **Until** dates. For Client, Consultant and Auditor the Until date is required (O-48).
3. Select **Save**. The project role appears with its dates and a status chip: _Active_, _Starts on …_ or _Ended_.

**Change or end a project role**

1. Select a project role → **Edit** (role, Until date) or **Remove**.
2. Removing asks for confirmation; the row moves to "Past project roles".

## Functional Requirements

The system shall:

1. Show the company role and the project roles in force or scheduled; past roles are listed under a collapsed "Past project roles" (T-34 keeps them).
2. Change the company role by ending the current company `user_role` row and inserting a new one in one batch (T-34). Pending invitations: update the invitation's `role_code` too.
3. Refuse to give the **last active Company Administrator** any other role (`LAST_ADMINISTRATOR`, O-24). This includes the administrator changing their own role.
4. Add a project role: the project must belong to the company and not be archived; the role must be allowed at project scope (PLT-16 list); at most one role in force or scheduled per user per project (O-47). Dates are calendar dates in the company's time zone: access starts at 00:00 on From and stops at 24:00 on Until.
5. Change a project role's role or Until date by ending the row and inserting a new one, keeping From.
6. Remove a project role by setting `valid_until` to now (never deleting the row).
7. Apply every change on the affected user's next request (T-32); no sign-out is needed.
8. When a project is archived (US-018), keep its project roles unchanged; the project is read-only anyway.

## Validation Rules

| Field        | Rule                                                                    | Message                                         |
| ------------ | ----------------------------------------------------------------------- | ----------------------------------------------- |
| Company role | One of the 13 company roles                                             | "Choose a role."                                |
| Project      | Required; in this company; not archived                                 | "Choose a project."                             |
| Project role | Allowed at project scope                                                | "This role can't be given on a project."        |
| From         | Optional date; not after Until                                          | "The start date must be before the end date."   |
| Until        | Optional date, today or later; required for Client, Consultant, Auditor | "An end date is required for this role."        |
| Duplicate    | No other role in force or scheduled for this user on this project       | "This user already has a role on this project." |

## Permission Rules

`users.view` to see the page; `users.roles.assign` for every change (company scope). The Change, Add and Remove controls are hidden without it.

## Database Impact

`user_role.project_id` foreign key to `project`; partial unique index on (`user_id`, `project_id`) for rows whose `valid_until` is null or in the future (enforced in the service too, because "in the future" can't be indexed). Index on (`project_id`) for Sprint 6 member lists.

## API Requirements

- `GET /api/v1/users/{id}` → adds `companyRole` and `projectRoles[]` (`id`, `projectId`, `projectCode`, `projectName`, `roleCode`, `validFrom`, `validUntil`, `state`: `active` / `scheduled` / `ended`).
- `PUT /api/v1/users/{id}/company-role` `{ roleCode }` → `200` with the user.
- `POST /api/v1/users/{id}/project-roles` `{ projectId, roleCode, validFrom?, validUntil? }` → `201`.
- `PATCH /api/v1/users/{id}/project-roles/{assignmentId}` `{ roleCode?, validUntil? }` → `200`.
- `DELETE /api/v1/users/{id}/project-roles/{assignmentId}` → `204`.

## UI Requirements

- User detail page, single column on phone. Company role as a row with a Change button; project roles as cards (project code and name, role, dates, status chip).
- Role names and descriptions in both languages; dates in the company's date format; right-to-left in Arabic with dates kept left-to-right.
- The users list gets a **Role** column (company role) and a "Projects" count.

## Error Handling

| Case                               | Response                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Last active administrator          | `422 LAST_ADMINISTRATOR`: "At least one active Company Administrator is required." |
| Role not allowed at project scope  | `422 ROLE_NOT_ALLOWED`                                                             |
| Duplicate project role             | `409 CONFLICT`: "This user already has a role on this project."                    |
| Archived project                   | `409 PROJECT_ARCHIVED`                                                             |
| User or project of another company | `404 NOT_FOUND`                                                                    |
| Read-only company                  | `403 SUBSCRIPTION_READ_ONLY`                                                       |

## Notifications

None in this sprint (in-app notifications are Sprint 6; Doc 08 §15 "Permission Updated" is added there).

## Audit Requirements

`user.role.changed` (before and after role), `user.project_role.added`, `user.project_role.changed`, `user.project_role.removed`, each with the user, project, role and dates (Doc 07 §16).

## Acceptance Criteria

- Changing a Safety Officer to HSE Manager lets them view every project on their next request, without signing in again.
- The only active Company Administrator can't change their own role; with a second administrator they can.
- A Client added to Project A until next Friday sees Project A until then and nothing afterwards, with no job needed.
- Adding a second role on the same project is refused; adding a role on another project works.
- Removing a project role keeps it under "Past project roles".
- Every change appears in the audit log with before and after.

## Test Scenarios

- **Positive:** change company role; add project role with and without dates; edit role and end date; remove; pending invitation's role changed.
- **Negative:** last administrator; Company Administrator as project role; Client without an end date; From after Until; Until in the past; duplicate; archived project; another company's user or project; read-only mode; caller without `users.roles.assign`.

## Future Improvements

Assigning members from the project page and by Project Managers (US-022, Sprint 6); bulk assignment; a reminder before temporary access ends (Sprint 6 notifications).
