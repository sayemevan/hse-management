# Sprint 5 — Roles, Permissions & Projects

**Status: DONE — accepted by the Product Owner on 2026-11-12 (D-45).** Approved by the Product Owner on 2026-11-11 (D-43), including technical decisions T-30 to T-37 and the proposed answers to open points O-43 to O-55 (D-44). O-43 answers Q-08 (the default permission matrix).

## Goal

Access follows the Product Book model **Identity → Role → Permission → Scope** (Doc 07 §2) for real. One permission matrix replaces the temporary checkers of Sprints 2–4. The Company Administrator can change a user's role, give people roles on individual projects (including temporary access), and adjust what each role may do in their company. Companies can create, edit, put on hold, complete and archive projects, within their plan's project limit. After this sprint, every later module (Sprint 6 onwards) attaches its records to a project and checks permissions at project scope.

## Scope

| ID     | Title                                    | Type             | Spec                                      |
| ------ | ---------------------------------------- | ---------------- | ----------------------------------------- |
| PLT-16 | Permission catalogue, matrix and checker | Platform enabler | [PLT-16](PLT-16-permission-matrix.md)     |
| US-008 | Role assignment (company and project)    | User story       | [US-008](US-008-role-assignment.md)       |
| US-009 | Permission assignment (roles screen)     | User story       | [US-009](US-009-permission-assignment.md) |
| US-016 | Create project, project list and detail  | User story       | [US-016](US-016-create-project.md)        |
| US-017 | Edit project and change status           | User story       | [US-017](US-017-edit-project.md)          |
| US-018 | Archive and restore project              | User story       | [US-018](US-018-archive-project.md)       |

Six items, inside the Doc 14 size range (5–10).

**Out of scope:**

- Custom roles, department / branch / team access, delegated authority (Doc 07 §17; see O-44).
- Area and Location scopes (Doc 07 §6 "Future"). Areas, Locations, Work Zones are Sprint 6 (US-019–021).
- The project-side **Members** screen and bulk adding of members (US-022, Sprint 6). This sprint assigns project roles from the user's page; Sprint 6 reuses the same API from the project page (see O-46).
- Project switcher in the header (Doc 06 §12) and project dashboard (Doc 08 §8): Sprint 6, when projects have content (O-55).
- Project documents (Doc 08 §11, Sprint 17), project activity timeline and notifications (Doc 08 §12, §15, Sprint 6). The audit log records every change meanwhile.
- Suspending or archiving users (Administration, Sprint 19).
- Editing the **platform** (System Owner) permissions: they are seeded data with no screen.

## Decisions applied

D-02 (14 roles), D-08 (one company per user), D-13 (project statuses with On Hold), D-17 and D-27 (project limits per plan: Basic 1, Pro 5, Enterprise unlimited), D-18 and D-30 (read-only mode blocks the new writes), O-23 (one company role per user), O-24 (several administrators; the last one can't be removed), O-41 (data over a limit is kept), T-14 and T-20 (temporary checkers, replaced here), T-24 (new write routes are blocked in read-only mode by default), T-29 (`PlanLimitService` is called before creating a project). See [PO_DECISIONS.md](../../architecture/PO_DECISIONS.md).

Doc 07 rules applied throughout: never hard-code permissions, check on the server, never trust client-side roles, one action per permission (§5), approval rights never implied by edit rights (§10), view separate from edit (§11), temporary access expires automatically (§12), every permission change is audited (§16).

## Technical decisions (proposed)

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-30 | The **permission catalogue** is one typed registry in code (each permission: code, module, scope level, whether it can be changed by companies), **seeded into a `permission` table** by migration. The **default matrix** is seed data in `role_permission`. **Company adjustments** are stored only as differences in `company_role_permission` (`granted` true or false).                                              | Each module declares its permissions in one place (as PLT-08 FR-5 planned); a later sprint adds a permission plus its default rows and every company gets it at once, with no back-fill. |
| T-31 | **One `MatrixPermissionChecker`** answers for every scope and replaces `systemOwnerPermissionChecker` (T-14) and `companyAdminPermissionChecker` (T-20). `requirePlatformPermission`, `requireCompanyPermission` and the new `requireProjectPermission` keep their names and signatures, so existing routes don't change. A unit test fails if any route uses a permission missing from the catalogue.                    | Route code stays as it is; a typo in a permission name can't silently deny (or allow) anything.                                                                                          |
| T-32 | Permissions are **read from the database on every request**, memoised for the length of that request only. No cross-request cache.                                                                                                                                                                                                                                                                                        | A role change, a removed project role or an adjusted permission takes effect on the very next request (Doc 07 §13 "immediately lose access"). The reads are three small indexed queries. |
| T-33 | **Scope rules.** Platform scope: platform roles only. Company scope: the user's company role, adjusted for the company. Project scope: the project must belong to the request's tenant; the user gets the union of (a) the project-scope permissions of their company role **if it is a company-wide role** (O-45) and (b) the permissions of their role **on that project**, if one is in force. Users must be `active`. | Matches Doc 06 §10–11 (company roles vs project roles) and Doc 07 §8 (different roles in different projects).                                                                            |
| T-34 | A role change **ends the old `user_role` row** (`valid_until` = now) and inserts a new one; rows are never updated in place or deleted. `user_role.project_id` gets its foreign key to `project`, and a partial unique index allows at most one role in force per user per project.                                                                                                                                       | Full history of who had which access when, for audits (Doc 07 §16), using the columns Sprint 1 already created.                                                                          |
| T-35 | A new **`project` module** owns the `project` table. It offers contracts to other modules: `ProjectDirectory` (does this project exist in this company, its status, `acceptsRecords`) and `ProjectCounter` (for `PlanLimitService`). The checker gets project facts through a small port wired at start-up, so `identity` doesn't import `project`.                                                                       | Module boundaries (Master Rules §3) without a circular import, the same approach as `company-admin` (Sprint 3) and `billing` (Sprint 4).                                                 |
| T-36 | Project dates (`start_date`, `expected_end_date`) are **calendar dates** stored as `YYYY-MM-DD` text, with no time zone. Status change times are normal timestamps.                                                                                                                                                                                                                                                       | A project starts on a day, not at an instant; no off-by-one between Riyadh and UTC.                                                                                                      |
| T-37 | The web app hides what the user can't do using `permissions` from `GET /auth/me` (company scope, as today) and a new `myPermissions` list on `GET /projects/{id}` (project scope). The server check remains the real protection.                                                                                                                                                                                          | Same pattern as PLT-08; no matrix logic copied into the browser.                                                                                                                         |

## Open points for Product Owner approval

| ID   | Question                                                                     | Proposed answer                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-43 | **Q-08: the default permission matrix.**                                     | **The matrix in [PLT-16 § Default matrix](PLT-16-permission-matrix.md#default-matrix)**, covering every permission that exists after this sprint. Each later sprint adds its own permissions with proposed defaults in its spec, for approval with that sprint.                                                                                                                    |
| O-44 | **Q-07:** fixed roles, or can companies create their own?                    | **Fixed 14 roles in Phase 1 (D-02).** Companies can't add roles, but the Company Administrator can **adjust which permissions each of the 13 company roles has** in their company (US-009), and reset a role to the platform default. Custom roles stay future (Doc 07 §17).                                                                                                       |
| O-45 | Which roles act in **every** project without being assigned to it?           | **Company Administrator, HSE Director and HSE Manager** ("company-wide roles"). Everyone else, including Project Manager, acts only in projects where they hold a project role. All users see the company information page.                                                                                                                                                        |
| O-46 | Who can assign roles in this sprint?                                         | **Only users with `users.roles.assign` (default: Company Administrator).** Letting Project Managers add people to their own projects is proposed for Sprint 6 (US-022), together with a rule that nobody can grant more than they hold themselves.                                                                                                                                 |
| O-47 | How many roles can a user hold?                                              | **One company role** (as today, O-23) **plus at most one role per project.** A Safety Officer on Project A can be a Supervisor on Project B (Doc 07 §8). The company role is required; project roles are optional.                                                                                                                                                                 |
| O-48 | **Q-14:** temporary access — who grants it and when does it expire?          | **Any project role can have a start and an end date**, set by whoever assigns it. Access starts and stops automatically on those dates. There is no default expiry, but the form **requires an end date for Client, Consultant and Auditor** project roles (Doc 07 §12). Company roles have no dates.                                                                              |
| O-49 | **Q-15:** who changes project status, and which changes are allowed?         | Holders of `projects.status.change` (default: Company Administrator, HSE Director, and the project's Project Manager). Allowed: Planning → Mobilization → Active → Completed; Planning → Active; Mobilization or Active → On Hold → back to the status it left; Completed → Active (reopen). Archiving is its own action (US-018). Every change is audited, with an optional note. |
| O-50 | **Q-16:** does **Mobilization** count as active for new operational records? | **Yes: Mobilization and Active accept new records** (site set-up already needs inspections and permits). Planning, On Hold, Completed and Archived don't. Later modules use one shared rule, `acceptsRecords(status)`, so this can change in one place. _Amends Doc 06 §9 / Doc 08 §6 wording "only active projects"._                                                             |
| O-51 | Project code rules?                                                          | **2–20 characters, capital letters, numbers and hyphens** (for example `RMX-02`), unique in the company including archived projects. Shown on every project record. It can be changed only while the project is in **Planning**; after that it is fixed, because later records and reports print it.                                                                               |
| O-52 | Which projects count towards the plan's project limit (Basic 1, Pro 5)?      | **Every project that is not archived.** Archiving a finished project frees a place; restoring one checks the limit again. Over the limit after a plan change (O-41), nothing is closed or hidden; only creating or restoring is refused.                                                                                                                                           |
| O-53 | Archive rules?                                                               | **From any status, by holders of `projects.archive` (default: Company Administrator only)**, with a confirmation that names the project. An archived project is **read-only** for everyone (Doc 06 §13), stays in the list under an "Archived" filter, and is never deleted. **Restore** returns it to the status it had before archiving.                                         |
| O-54 | Can the Company Administrator lock themselves out by editing permissions?    | **No.** Some permissions of the Company Administrator role are **locked**: viewing and assigning roles, editing permissions, viewing users, and company view. The last active Company Administrator can't be given another role (O-24). Permission changes apply immediately (T-32) and are audited with before and after.                                                         |
| O-55 | Project switcher in the header (Doc 06 §12)?                                 | **Sprint 6**, with Areas, Locations and Members, when there is something inside a project to switch to. This sprint has a project list and a project page.                                                                                                                                                                                                                         |

## Data model introduced

| Table                     | Purpose                                                                                                                     | Spec           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `permission`              | Catalogue: code, module, scope level, `company_editable`; seeded from the code registry                                     | PLT-16         |
| `role_permission`         | Default matrix: role code × permission (seeded)                                                                             | PLT-16         |
| `company_role_permission` | A company's differences from the default: company, role, permission, `granted`, who and when                                | PLT-16, US-009 |
| `project`                 | Code, name, client, contract number, description, city, country, start and expected end dates, status, archive details      | US-016–018     |
| `user_role` (extended)    | Foreign key `project_id` → `project`; partial unique index (one role in force per user per project); never updated in place | US-008         |

## API introduced

All under `/api/v1`, standard envelope, company routes on the company's subdomain.

| Method & path                                   | Permission (scope)                          | Story  |
| ----------------------------------------------- | ------------------------------------------- | ------ |
| `GET /auth/me` (extended)                       | signed in                                   | PLT-16 |
| `GET /roles`                                    | `roles.view` (company)                      | US-009 |
| `GET /roles/{roleCode}`                         | `roles.view` (company)                      | US-009 |
| `PUT /roles/{roleCode}/permissions`             | `roles.permissions.edit` (company)          | US-009 |
| `POST /roles/{roleCode}/permissions/reset`      | `roles.permissions.edit` (company)          | US-009 |
| `GET /users/{id}` (extended with roles)         | `users.view` (company)                      | US-008 |
| `PUT /users/{id}/company-role`                  | `users.roles.assign` (company)              | US-008 |
| `POST /users/{id}/project-roles`                | `users.roles.assign` (company)              | US-008 |
| `PATCH /users/{id}/project-roles/{assignment}`  | `users.roles.assign` (company)              | US-008 |
| `DELETE /users/{id}/project-roles/{assignment}` | `users.roles.assign` (company)              | US-008 |
| `GET /projects?search=&status=&page=`           | signed in; lists projects the user can view | US-016 |
| `POST /projects`                                | `projects.create` (company)                 | US-016 |
| `GET /projects/{id}`                            | `projects.view` (project)                   | US-016 |
| `PATCH /projects/{id}`                          | `projects.edit` (project)                   | US-017 |
| `POST /projects/{id}/status`                    | `projects.status.change` (project)          | US-017 |
| `POST /projects/{id}/archive`                   | `projects.archive` (project)                | US-018 |
| `POST /projects/{id}/restore`                   | `projects.archive` (project)                | US-018 |

New error codes: `PROJECT_CODE_TAKEN`, `PROJECT_CODE_LOCKED`, `INVALID_STATUS_TRANSITION`, `PROJECT_ARCHIVED` (409); `LAST_ADMINISTRATOR`, `PERMISSION_LOCKED`, `ROLE_NOT_ALLOWED` (422). `PLAN_LIMIT_REACHED` (409) on create and restore. Every new write route is refused with `403 SUBSCRIPTION_READ_ONLY` in read-only mode (T-24; none is added to the allow-list).

## Screens introduced

| Screen                                               | Where                                     | Story          |
| ---------------------------------------------------- | ----------------------------------------- | -------------- |
| User detail with roles (company role, project roles) | `<slug>/settings/users/{id}`              | US-008         |
| Roles & permissions (role list, role detail)         | `<slug>/settings/roles`, `…/roles/{code}` | US-009         |
| Projects list (search, status filter, New project)   | `<slug>/projects`                         | US-016         |
| Project page (details, status, actions)              | `<slug>/projects/{id}`                    | US-016–018     |
| New / edit project form                              | dialog on phone width, page on desktop    | US-016, US-017 |

## Definition of Done

- Every acceptance criterion in the six specs passes.
- **Matrix tests:** a table-driven unit test checks every role × every permission against the approved O-43 matrix at company and project scope, including company adjustments, locked permissions, expired and future project roles, a project of another company, and a suspended user.
- **No unintended behaviour change for existing routes:** the Sprint 2–4 integration tests pass with the new checker (System Owner, Company Administrator and ordinary user cases); any case that changes because O-43 grants a non-administrator role more is listed in the implementation notes.
- Integration tests for each new endpoint against the local runtime, including read-only mode, the project limit on create and restore, the last-administrator rule, and every refused status change.
- Browser check in **Arabic and English** at phone width: Company Administrator creates a project → second project refused on Basic → invites a Safety Officer → gives them a role on the project with an end date → the Safety Officer sees only that project → administrator turns off "Edit project" for the Project Manager role, and a Project Manager loses the Edit button on the next page load → project put On Hold, back to Active, completed, archived (read-only), restored.
- `npm run check` and `npm run build` pass; migrations apply to a fresh local D1 and on top of the Sprint 4 data (System Owners and Company Administrators keep exactly the access they had; other existing users get their role's defaults).
- `03_DATABASE.md`, `04_API.md` and the module README are updated; the temporary-checker notes in `04_API.md` are removed.

## Implementation notes

### Refinements made during implementation (for acceptance)

| Item                        | Approved text                                                    | As built                                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-34 `user_role.project_id` | Foreign key to `project` and a partial unique index              | Index on `project_id`, no database foreign key; "one role per user per project" is checked by the service.                                                                                                                            | The project module depends on identity, so identity's schema can't reference `project` without a cycle (same choice as `company.logo_file_id` in Sprint 3). "In force or scheduled" depends on the clock, which an index can't express. |
| T-35 project port           | A port wired at start-up so identity can check project facts     | `requireProjectPermission` lives in the project module: it loads the project in the tenant, then asks identity's resolver. Role-assignment routes live in a new `access` module that uses `ProjectDirectory` and identity's services. | Same separation without global wiring; identity never imports project.                                                                                                                                                                  |
| PLT-16 FR-11 unknown codes  | A unit test fails for an unknown permission code                 | Guards take typed codes (`CompanyPermissionCode`, `ProjectPermissionCode`, `PlatformPermissionCode`), so an unknown code doesn't compile; an integration test checks the seeded tables equal the shared catalogue.                    | Stronger than a test, and no route list to keep in step.                                                                                                                                                                                |
| PLT-16 API `/auth/me`       | Adds `companyRole` and `projectRoles` with project code and name | Adds `companyRole`; project roles stay in the existing `roles` list (with `projectId`). The user page shows names.                                                                                                                    | Identity doesn't read projects (T-35).                                                                                                                                                                                                  |
| US-016 country default      | The company's country                                            | Saudi Arabia preselected.                                                                                                                                                                                                             | The tenant profile has no country; the field is required and changeable.                                                                                                                                                                |
| US-016 UI                   | Table on desktop                                                 | Cards at every width, as the other lists.                                                                                                                                                                                             | Same information.                                                                                                                                                                                                                       |
| US-017 version check        | Optimistic concurrency                                           | A guard statement first in the batch writes NULL into a NOT NULL column when the version is stale, so the change and its audit entry fail together.                                                                                   | D1 batches can't branch (same technique as the Sprint 4 double-review guard).                                                                                                                                                           |
| US-009 desktop matrix view  | Optional read-only grid                                          | Not built.                                                                                                                                                                                                                            | Optional; the grouped list works at every width.                                                                                                                                                                                        |
| Users list                  | —                                                                | Shows only the company role in force, plus "n projects"; the name links to the user page.                                                                                                                                             | Ended rows are kept (T-34) and must not show.                                                                                                                                                                                           |
| Calendar dates              | —                                                                | Project and role dates are shown in the company's date format, isolated left-to-right inside sentences.                                                                                                                               | Found in the browser check: "31-12-2026" reordered in Arabic.                                                                                                                                                                           |

### Added beyond the specs

- `PermissionResolver` exported from identity, used by the project list (`projectAccess`) and a table-driven test of every role × every permission at company and project scope.
- `zonedDayStart`, `zonedIsoDate`, `nextIsoDate` in the shared package (project-role dates in the company time zone, with daylight-saving tests).
- The company information account summary includes project usage, shown on the projects page ("1 of 1 projects").
- Header link to Projects on company subdomains; home links to Projects and Roles & permissions.

### Known gaps

- Behaviour change for existing users, as approved in O-43: HSE Directors and HSE Managers now see the users list; HSE Directors see the roles screen and can create projects. Sprint 2–4 tests needed no change.
- No in-app notifications for role or project changes (Sprint 6); the audit log records them.
- A Project Manager can't yet add people to their own project (O-46, Sprint 6).
- No reminder before temporary access ends (Sprint 6 notifications).
- The dev seed has no sample project; local data from the browser check (project RMX-02, a Client role for the demo officer, and Project Manager without "Edit project") remains in the local database.

### Verification

- `npm run check` passes: formatting, lint, i18n keys, typecheck, shared 56 tests (13 new) and API 211 tests (32 new: projects 16, roles and permissions 16 incl. the full matrix and the catalogue check; the PLT-11 route review lists the 11 new write routes as blocked in read-only mode). `npm run build` passes.
- Migrations `0006` and `0007` applied to the existing local D1 with Sprint 4 data.
- Browser (local dev, 375 px):
  - Arabic, demo Company Administrator: home shows Projects and Roles & permissions → empty project form shows the errors → project created as Active (code typed in lower case stored as `RMX-02`) → Change status offers only On Hold and Completed → On Hold ("no new safety records") → archive needs the code typed → archived banner → restore returns to On Hold → list shows "1 of 1 projects" with New project disabled and the reason (Basic).
  - Same administrator: safety officer's page → Add to project as Client → saving without Until shows "An end date is required" → saved with 31 Dec 2026, shown Active.
  - Roles & permissions: 13 roles with counts and "All projects" labels → Project Manager → turn off "Edit project" → "1 unsaved change" bar → confirmation lists the change → saved, "Changed from default" shown.
  - Arabic then English, demo safety officer: the list shows only RMX-02, no New project; the project page has no actions. No console errors.
- Not checked in the browser: a Project Manager losing the Edit button (no Project Manager in the dev seed; covered by integration tests), reset to default, and editing or removing a project role (integration tests).
