# US-009 — Permission Assignment

| Field    | Value                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security                                                     |
| Priority | Must                                                                                    |
| Status   | Approved                                                                                |
| Sources  | Product Book Doc 14, Doc 07 §5, §7, §9–11, §16, §18; D-02; T-30, T-32; O-43, O-44, O-54 |

## Business Goal

Each company decides what its roles may do, within the 14 fixed roles, without asking for code changes: a small contractor can let Project Managers archive their projects, a cautious one can keep editing with the HSE Director only.

## User Story

As a **Company Administrator**, I want to see what each role can do and turn individual permissions on or off for my company, so that access follows our own way of working.

## Description

**Settings → Roles & permissions** lists the 13 company roles with a short description and the number of users holding each. Opening a role shows its permissions grouped by module (Doc 07 §9), separated into "Company-wide" and "On projects", each with a switch. Changed permissions are marked "Changed from default". The administrator saves the role, or resets it to the platform default.

## Actors

Company Administrator (`roles.permissions.edit`); HSE Director (`roles.view`, read only by default).

## Preconditions

- Signed in on the company's subdomain with `roles.view` (to see) or `roles.permissions.edit` (to change).
- The company isn't read-only for changes (T-24).

## User Flow

1. Open **Settings → Roles & permissions**. Each role shows its name, description, user count and "Customised" if it differs from the default.
2. Select a role. Permissions appear in module groups with a switch and a one-line meaning; locked ones show a lock icon and the reason.
3. Turn switches on or off. A bar shows "{n} unsaved changes" with **Save** and **Discard**.
4. **Save**: a confirmation lists what changes and how many users hold the role. The page shows the new state.
5. **Reset to default** (only when customised): confirmation, then the role goes back to the platform defaults.

## Functional Requirements

The system shall:

1. List every company role with name, description (both languages), number of active users holding it as company role or project role, and whether it is customised.
2. Show a role's permissions from the catalogue (PLT-16), grouped by module and by scope, with the effective value and whether it differs from the default.
3. Accept the full desired set of permissions for one role and store **only the differences** from the default in `company_role_permission` (T-30); a permission set back to its default removes its row.
4. Refuse to turn off a **locked** permission (O-54) or change a permission that isn't `company_editable`.
5. Refuse platform permissions for every company role. Company-scope and project-scope permissions can be given to any company role: company-scope ones apply through the user's company role, project-scope ones through company-wide roles (O-45) or the user's role on a project.
6. Apply changes on the next request of every affected user (T-32).
7. Reset a role by deleting its rows in `company_role_permission`.
8. Save a role's changes atomically (one batch); a concurrent save by another administrator is detected with the role's `version` (last change time) and refused with "Someone else changed this role. Reload to see their changes."

## Validation Rules

| Field       | Rule                                      | Message                                                        |
| ----------- | ----------------------------------------- | -------------------------------------------------------------- |
| Role code   | One of the 13 company roles               | "Unknown role."                                                |
| Permissions | Each in the catalogue, not platform-scope | "Unknown permission: {code}."                                  |
| Locked      | Locked permissions present                | "{permission} can't be turned off for this role."              |
| Version     | Matches the stored version                | "Someone else changed this role. Reload to see their changes." |

## Permission Rules

`roles.view` to see; `roles.permissions.edit` to save and reset (company scope). Both locked on for Company Administrator (O-54).

## Database Impact

Writes `company_role_permission` (PLT-16). No other table.

## API Requirements

- `GET /api/v1/roles` → `[{ code, userCount, customised }]` (names and descriptions come from the web app's translations by code).
- `GET /api/v1/roles/{roleCode}` → `{ code, version, permissions: [{ code, module, scope, granted, default, locked, editable }] }`.
- `PUT /api/v1/roles/{roleCode}/permissions` `{ version, granted: string[] }` → `200` with the role.
- `POST /api/v1/roles/{roleCode}/permissions/reset` `{ version }` → `200` with the role.

## UI Requirements

- Phone first: role list as cards; role page as grouped lists with switches (no wide grid). On desktop, an optional read-only **matrix view** (roles across, permissions down) for comparison.
- Every permission has a translated label and meaning in Arabic and English; codes are never shown.
- Without `roles.permissions.edit`, switches are shown disabled with "View only".

## Error Handling

| Case                    | Response                     |
| ----------------------- | ---------------------------- |
| Locked permission off   | `422 PERMISSION_LOCKED`      |
| Unknown role/permission | `422 VALIDATION_FAILED`      |
| Version mismatch        | `409 CONFLICT`               |
| Read-only company       | `403 SUBSCRIPTION_READ_ONLY` |

## Notifications

None in this sprint.

## Audit Requirements

`role.permissions.changed` with the role, permissions added, permissions removed and the number of affected users; `role.permissions.reset` with the same detail (Doc 07 §16 "Permission Changes").

## Acceptance Criteria

- The role list shows all 13 company roles with correct user counts.
- Turning on `projects.archive` for Project Manager lets a Project Manager archive their project on their next request; resetting the role removes it again.
- The lock prevents removing `roles.permissions.edit` from Company Administrator, both in the UI and through the API.
- An HSE Director sees the roles but can't change them.
- Two administrators saving the same role at once: the second gets the conflict message and nothing is overwritten.
- Every save and reset appears in the audit log with what changed.

## Test Scenarios

- **Positive:** grant, revoke, set back to default (row removed), reset; matrix view.
- **Negative:** locked permission; platform permission; unknown code; stale version; caller with `roles.view` only; read-only mode; another company's data never affected.

## Future Improvements

Custom roles and copying a role (Doc 07 §17, O-44); a "preview access as this role" view.
