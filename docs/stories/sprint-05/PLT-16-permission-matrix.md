# PLT-16 — Permission Catalogue, Matrix and Checker

| Field    | Value                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform enabler                                                                                                                                   |
| Priority | Must                                                                                                                                               |
| Status   | Approved                                                                                                                                           |
| Sources  | Product Book Doc 06 §10–11, Doc 07 §2–11, §16, §18; Master Rules (Permission, deny by default); D-02; T-14, T-20, T-30–T-35; O-43–O-45, O-47, O-54 |

## Business Goal

Every authorization decision follows one rule set that the Product Owner approved and each company can adjust, instead of the hard-coded temporary checkers of Sprints 2–4.

## Description

A catalogue lists every permission once. A default matrix says which role holds which permission. A company can turn individual permissions on or off for its roles (US-009). One checker answers "may this user do X here?" at platform, company or project scope. Routes keep calling the same guards with the same permission names.

## Actors

Every signed-in user (indirectly); developers adding modules.

## Preconditions

- `requirePermission()`, `requirePlatformPermission()` and `requireCompanyPermission()` exist (Sprints 0–3).
- `user_role` has `scope_level`, `company_id`, `project_id`, `valid_from`, `valid_until` (Sprint 1).
- The `project` table exists (US-016) before project scope is checked.

## Functional Requirements

The system shall:

1. Keep one **permission registry** in code. Each entry has a code (`<module>.<action>`, Doc 07 §5), a module (for grouping, Doc 07 §9), a scope level (`platform`, `company` or `project`) and whether companies may change it. The registry is seeded into the `permission` table (T-30).
2. Seed the **default matrix** of [§ Default matrix](#default-matrix) into `role_permission`.
3. Work out a user's permissions as: default matrix for the role, then the company's differences from `company_role_permission` (US-009), then the **locked** permissions forced on (O-54).
4. Grant **platform** permissions only to platform roles (`system_owner`). Companies can't see or change them.
5. Grant **company** permissions from the user's company role (one per user, O-47), only while the user is `active` and belongs to the request's company.
6. Grant **project** permissions (T-33) only for a project that belongs to the request's company, as the union of:
   - the project-scope permissions of the user's company role, **if** it is a company-wide role: Company Administrator, HSE Director, HSE Manager (O-45); and
   - the permissions of the user's role **on that project**, if one is in force now (`valid_from` ≤ now < `valid_until`).
7. Deny everything else (Master Rules: deny by default), including any permission not in the catalogue, any scope of another company, and any user who isn't `active`.
8. Replace `systemOwnerPermissionChecker` and `companyAdminPermissionChecker` with one `MatrixPermissionChecker` (T-31). `requirePlatformPermission` and `requireCompanyPermission` keep their signatures; add `requireProjectPermission(permission, projectIdParam = 'id')`, which reads the project id from the route and checks it belongs to the tenant. A project that is unknown, in another company, or one the user can't view (`projects.view`) returns `404`, so ids can't be probed; a project the user can view but can't act on returns `403`.
9. Read permissions from the database on each request, memoised for that request only (T-32), so changes apply on the next request.
10. Offer `listCompanyPermissions(userId, companyId)` and `listProjectPermissions(userId, projectId)` for `GET /auth/me` and the project detail (T-37), and `listViewableProjectIds(userId, companyId)` for the project list (US-016).
11. Fail the build (unit test) if any route guard uses a permission code that isn't in the registry, or if a registry entry has no row in the default matrix (even if no role holds it, the test lists it on purpose).

## Default matrix

Proposed answer to **Q-08 / O-43**. ✓ = granted by default, 🔒 = granted and locked (can't be turned off, O-54), — = not granted. Platform roles: **System Owner** only.

Role columns: **CA** Company Administrator, **HD** HSE Director, **HM** HSE Manager, **PM** Project Manager, **SO** Safety Officer, **SE** Site Engineer, **SV** Supervisor, **FM** Foreman, **IN** Inspector, **WK** Worker, **CL** Client, **CO** Consultant, **AU** Auditor.

### Company scope (from the user's company role)

| Module       | Permission               | Meaning                                       | CA  | HD  | HM  | PM  | SO  | SE  | SV  | FM  | IN  | WK  | CL  | CO  | AU  |
| ------------ | ------------------------ | --------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Company      | `company.view`           | See the company information page              | 🔒  | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   |
| Company      | `company.edit`           | Edit name, address, registration number       | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Company      | `company.settings.edit`  | Edit language, date/time format, working week | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Company      | `company.logo.edit`      | Upload or remove the logo                     | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Users        | `users.view`             | See the users list and user details           | 🔒  | ✓   | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Users        | `users.invite`           | Invite, resend and cancel invitations         | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Users        | `users.roles.assign`     | Change company roles, assign project roles    | 🔒  | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Roles        | `roles.view`             | See roles and their permissions               | 🔒  | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Roles        | `roles.permissions.edit` | Change what each role may do                  | 🔒  | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Subscription | `subscription.view`      | See plan, usage and payment history           | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Subscription | `subscription.pay`       | Submit or withdraw a payment proof            | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Projects     | `projects.create`        | Create a project                              | ✓   | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |

### Project scope

CA, HD and HM hold these in **every** project of the company (O-45). Every other role holds them only in projects where it is the user's **project role**.

| Module   | Permission               | Meaning                                        | CA  | HD  | HM  | PM  | SO  | SE  | SV  | FM  | IN  | WK  | CL  | CO  | AU  |
| -------- | ------------------------ | ---------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Projects | `projects.view`          | See the project and its details                | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   |
| Projects | `projects.edit`          | Edit the project's details                     | ✓   | ✓   | —   | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Projects | `projects.status.change` | Move between Planning, Mobilization, Active, … | ✓   | ✓   | —   | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Projects | `projects.archive`       | Archive and restore the project                | ✓   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |

### Platform scope (not editable by companies)

| Permission                       | System Owner |
| -------------------------------- | ------------ |
| `platform.registrations.view`    | ✓            |
| `platform.registrations.approve` | ✓            |
| `platform.registrations.reject`  | ✓            |
| `platform.payments.review`       | ✓            |
| `platform.subscriptions.view`    | ✓            |

### Roles allowed at each scope

- **Company role** (one per user, required): any of the 13 company roles (unchanged from O-23).
- **Project role** (at most one per project, O-47): HSE Manager, Project Manager, Safety Officer, Site Engineer, Supervisor, Foreman, Inspector, Worker, Client, Consultant, Auditor. Company Administrator and HSE Director are company-wide only.

Later sprints add their own permissions (for example `inspection.create`, `inspection.approve`) with a proposed default column per role, approved with that sprint's specs.

## Validation Rules

None (no input). The registry is checked by unit tests (FR-11).

## Permission Rules

This item defines them.

## Database Impact

- `permission` (`code` PK, `module`, `scope_level`, `company_editable`, `sort_order`).
- `role_permission` (`role_code`, `permission_code`; PK on both).
- `company_role_permission` (`id`, `company_id`, `role_code`, `permission_code`, `granted` boolean, audit columns; unique on company + role + permission). Only differences from the default are stored.
- Migration seeds both catalogue tables. No change to existing `user_role` rows is needed: every Sprint 1–4 role row is already a company-scope (or platform) row.

## API Requirements

- `GET /auth/me` keeps `permissions` (company scope) and adds `companyRole` and `projectRoles` (`{ projectId, projectCode, projectName, roleCode, validFrom, validUntil }`).
- No other endpoint; US-008, US-009 and US-016 use the checker.

## UI Requirements

Unchanged pattern (T-37): menu entries and buttons appear only when the matching permission is in `permissions` or the project's `myPermissions`.

## Error Handling

- `403 FORBIDDEN`: "You don't have permission to do this." (existing).
- `404 NOT_FOUND` for a project outside the user's company (FR-8).

## Notifications

None.

## Audit Requirements

The existing "permission denied" log line, now with the permission and scope. Changes to the matrix are audited by US-009, role changes by US-008.

## Acceptance Criteria

- Every cell of the default matrix holds for a user with that role, at company and project scope (table-driven test).
- A Safety Officer with a project role on Project A gets `projects.view` on A and `404` on Project B.
- An HSE Manager with no project role gets `projects.view` on every project of their company and nothing in another company.
- A project role that ended yesterday, or starts tomorrow, grants nothing.
- After the company turns off `projects.edit` for Project Manager, the next request by a Project Manager is refused; after "reset to default" it is allowed again.
- Locked permissions stay granted even if a `company_role_permission` row says otherwise.
- All Sprint 2–4 integration tests pass. The only expected changes are cases where a non-administrator role is now granted by the default matrix (for example HSE Director viewing users); each such change is listed in the implementation notes.
- A route guard with an unknown permission code makes the unit tests fail.

## Test Scenarios

- **Positive:** each role × permission; company-wide role on an unassigned project; union of company-wide role and a project role.
- **Negative:** suspended, locked or pending user; user of company A on company B's subdomain; System Owner on a company route; company user on a platform route; unknown permission code; project of another company; expired or future project role.

## Future Improvements

Area and Location scopes (Doc 07 §6), custom roles, delegated authority (Doc 07 §17), and a "no more than you hold" rule for non-administrators assigning roles (Sprint 6, O-46).
