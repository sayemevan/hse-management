# US-016 — Create Project, Project List and Project Page

| Field    | Value                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Epic     | Epic 03 — Project Management                                                                                 |
| Priority | Must                                                                                                         |
| Status   | Approved                                                                                                     |
| Sources  | Product Book Doc 14, Doc 06 §4, §9, Doc 08 §5–6, §13–14; D-13, D-17, D-27; O-41; T-29, T-35, T-36; O-50–O-52 |

## Business Goal

Every inspection, permit, incident and action from Sprint 6 onwards belongs to a project (Doc 06 §4, Doc 08 "no operational activity without an active company and project"). Companies need to set their projects up first.

## User Story

As a **Company Administrator or HSE Director**, I want to create a project with its code, client and dates, so that our teams can record their safety work against it.

## Description

**Projects** in the main menu lists the projects the user can see, with search and a status filter. Users with `projects.create` see **New project**. The form asks for the project's identity, client, location and dates. A new project starts in **Planning** (or the chosen first status). The project page shows its details, status and the actions the user may take.

## Actors

Company Administrator, HSE Director (create); every user with `projects.view` on a project (view).

## Preconditions

- Signed in on the company's subdomain.
- To create: `projects.create`, company not read-only, and the plan's project limit not reached (D-27, O-52).

## User Flow

**Create**

1. Open **Projects** → **New project**.
2. Enter name, code, client name, contract number (optional), description (optional), city and country (country defaults to the company's), start date and expected completion date, and the first status (**Planning** by default, or **Mobilization** / **Active**).
3. Select **Create project**. The project page opens.

**List and view**

1. **Projects** shows cards (phone) or a table (desktop): code, name, client, status chip, dates.
2. Search by name, code or client; filter by status. Archived projects are hidden unless the **Archived** filter is chosen.
3. Select a project to open its page.

## Functional Requirements

The system shall:

1. Check the plan's project limit with `PlanLimitService.assertCanAdd(companyId, 'projects', 1)` before creating (T-29); non-archived projects count (O-52). The project module provides the count through `ProjectCounter` (T-35), replacing Sprint 4's fixed 0.
2. Create the project with the entered fields, the chosen first status (Planning, Mobilization or Active) and audit columns.
3. Keep the code unique within the company, archived projects included, comparing in upper case (O-51).
4. List only the projects where the user holds `projects.view` (PLT-16 FR-10): every project for company-wide roles, assigned ones for everyone else.
5. Search name, code and client (case-insensitive, Arabic and English text as typed), filter by one or more statuses, sort by code by default, page by 25.
6. Return the project with `myPermissions` (T-37) and `acceptsRecords` (O-50).
7. Show the subscription page's **project usage** ("{used} of {limit} projects") from the same count (PLT-13).
8. Expose `ProjectDirectory.get(companyId, projectId)` → `{ id, code, name, status, acceptsRecords }` for later modules, and the shared `acceptsRecords(status)` rule: true for Mobilization and Active only.

## Validation Rules

| Field                    | Rule                                                            | Message                                                                                           |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Name                     | Required, 2–120 characters after trimming                       | "Enter the project name."                                                                         |
| Code                     | Required, 2–20, `A–Z`, `0–9`, `-`; stored in upper case; unique | "Use 2–20 capital letters, numbers or hyphens." / "This code is already used by another project." |
| Client name              | Required, 2–120 characters                                      | "Enter the client's name."                                                                        |
| Contract number          | Optional, up to 60 characters                                   | "Contract number is too long."                                                                    |
| Description              | Optional, up to 2,000 characters                                | "Description is too long."                                                                        |
| City                     | Optional, up to 80 characters                                   | —                                                                                                 |
| Country                  | Required, ISO 3166-1 alpha-2 from the shared country list       | "Choose a country."                                                                               |
| Start date               | Required date                                                   | "Enter the start date."                                                                           |
| Expected completion date | Optional date, not before the start date                        | "The completion date can't be before the start date."                                             |
| First status             | Planning, Mobilization or Active                                | "Choose a status."                                                                                |

## Permission Rules

- `projects.create` (company scope) to create.
- `projects.view` (project scope) to open a project; the list is filtered by it.

## Database Impact

New table `project`:

| Column                                        | Type / rule                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `id`                                          | UUID v7                                                                  |
| `company_id`                                  | FK `company`, not null                                                   |
| `code`                                        | text, upper case; unique (`company_id`, `code`)                          |
| `name`, `client_name`                         | text, not null                                                           |
| `contract_number`, `description`, `city`      | text, nullable                                                           |
| `country_code`                                | text(2), not null                                                        |
| `start_date`, `expected_end_date`             | text `YYYY-MM-DD` (T-36); end nullable                                   |
| `status`                                      | `planning`, `mobilization`, `active`, `on_hold`, `completed`, `archived` |
| `status_before_hold`, `status_before_archive` | nullable, for returning from On Hold and restore (US-017, US-018)        |
| `status_changed_at`                           | timestamp                                                                |
| `archived_at`, `archived_by`                  | nullable                                                                 |
| audit columns                                 | `created_at/by`, `updated_at/by`                                         |

Indexes: (`company_id`, `status`), (`company_id`, `name`). No soft delete: projects are never deleted (Doc 06 §13).

## API Requirements

- `GET /api/v1/projects?search=&status=planning,active&page=` → paged list (`id`, `code`, `name`, `clientName`, `status`, `startDate`, `expectedEndDate`).
- `POST /api/v1/projects` → `201` with the project.
- `GET /api/v1/projects/{id}` → project with `myPermissions[]` and `acceptsRecords`.

## UI Requirements

- **Projects** appears in the main navigation for every signed-in company user; empty state "No projects yet" with **New project** for creators, or "You haven't been added to a project yet" for others.
- Form as a full-screen dialog on phone, page on desktop; dates with the company's date format; code field forces capitals as typed.
- Status chips with colour and text (never colour alone): Planning grey, Mobilization blue, Active green, On Hold amber, Completed teal, Archived dark grey.
- At the project limit, **New project** is disabled with "Your plan allows {limit} projects. Archive a finished project or upgrade." and a link to the subscription page.
- Arabic right-to-left; code, dates and contract number shown left-to-right.

## Error Handling

| Case              | Response                          |
| ----------------- | --------------------------------- |
| Code taken        | `409 PROJECT_CODE_TAKEN`          |
| Project limit     | `409 PLAN_LIMIT_REACHED`          |
| Invalid input     | `422 VALIDATION_FAILED` per field |
| Unknown project   | `404 NOT_FOUND`                   |
| Read-only company | `403 SUBSCRIPTION_READ_ONLY`      |

## Notifications

None (Doc 08 §15 "Project Activated" arrives with in-app notifications, Sprint 6).

## Audit Requirements

`project.created` with all fields.

## Acceptance Criteria

- A Company Administrator on Basic creates one project; the second is refused with the limit message, and the subscription page shows "1 of 1 projects".
- Codes are unique case-insensitively (`rmx-02` after `RMX-02` is refused).
- A Safety Officer with a role on one project sees only that project in the list; an HSE Manager sees all.
- Search finds a project by an Arabic client name and by part of the code.
- The project page shows only the actions the user may take.

## Test Scenarios

- **Positive:** create with minimum and full fields; create as Active; list, search, filter, paging; Enterprise has no limit.
- **Negative:** each validation rule; duplicate code; limit on Basic and Pro; read-only mode; caller without `projects.create`; opening another company's project id; non-member opening a project id directly (`404`).

## Future Improvements

Project switcher and dashboard (Sprint 6); filters by start/completion date and country (Doc 08 §14) when lists grow; project logo or cover image.
