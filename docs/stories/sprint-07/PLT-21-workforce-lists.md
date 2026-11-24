# PLT-21 — Workforce Lists: Job Positions and Competencies

| Field    | Value                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Personal Information: Job Position")               |
| Priority | Must                                                                                       |
| Status   | Approved                                                                                   |
| Sources  | Doc 09 §6, §7, §19 ("treat certifications and trainings as reusable entities"); T-54; O-77 |

## Business Goal

Companies name their trades differently, so job positions must be configurable (Doc 09 §6). Competencies such as Working at Height or Confined Space Entry are what later permits and risk assessments will require (Doc 09 §7 "support future permit validation"), so training records and certificates must point to a **shared list** rather than free text.

## User Story

As an **HSE Manager**, I want to keep my company's list of job positions and competencies, so that profiles, assignments, training and certificates use the same names.

## Description

**Settings → Workforce lists** has two tabs: **Job positions** and **Competencies**. Each list is seeded for every company (T-54) and can be extended.

Seeded **job positions** (Doc 09 §6): Safety Officer, HSE Manager, Site Engineer, Electrician, Welder, Rigger, Scaffolder, Crane Operator, Carpenter, Driver.

Seeded **competencies** (Doc 09 §7): Working at Height, First Aid, Fire Fighting, Rigging, Lifting Operations, Confined Space Entry.

Rules:

- Items have a name (2–80, unique in the list ignoring case), an order and an active flag.
- Seeded items show in the reader's language until renamed; once renamed they show the saved name to everyone.
- Items are **deactivated, not deleted**, once used by any profile, assignment, training or certificate; unused custom items can be deleted.
- Inactive items aren't offered in pickers but stay on existing records.
- Up to 300 items per list.

## Actors

Holders of `workforce.lists.manage` (O-77: Company Administrator, HSE Director, HSE Manager); every signed-in user reads active items (pickers).

## Preconditions

- Signed in on the company's subdomain; to change, `workforce.lists.manage` and the company isn't read-only.

## User Flow

1. **Settings → Workforce lists → Job positions**: the list in order with Inactive items under "Show inactive".
2. **Add position** → name → **Save** (appears last).
3. Item menu: **Rename**, **Move up**, **Move down**, **Deactivate** / **Reactivate**, **Delete** (unused custom items only; otherwise "Welder is used by 14 people, so it can't be deleted. Deactivate it instead.").

## Functional Requirements

The system shall:

1. Seed both lists for every new company at creation, and for existing companies by migration (T-54).
2. List items of a list in order, active only unless `includeInactive=true`.
3. Create, rename, move up or down, deactivate, reactivate and delete items as in the description.
4. Expose `WorkforceLists.resolve(itemIds)` in the module contract for later modules (permits will name required competencies).

## Validation Rules

| Field | Rule                                                                                  | Message                                               |
| ----- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| List  | `job_position` or `competency`                                                        | `404` for anything else                               |
| Name  | Required, 2–80 characters; unique in the list ignoring case, including inactive items | "Enter a name." / "This name is already in the list." |

## Permission Rules

- New permission **`workforce.lists.manage`** (company). Proposed defaults (O-77): CA ✓, HD ✓, HM ✓, PM —, SO —, SE —, SV —, FM —, IN —, WK —, CL —, CO —, AU —. Company-editable.
- Reading active items: any signed-in user of the company.

## Database Impact

New table `workforce_list_item`:

| Column        | Type / rule                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| `id`          | UUID v7                                                                     |
| `company_id`  | not null                                                                    |
| `list`        | `job_position`, `competency`                                                |
| `seed_key`    | nullable; translation key of a seeded item, cleared on rename               |
| `name`        | text, not null (English seed name for seeded items); `name_key` lower-cased |
| `position`    | integer                                                                     |
| `active`      | boolean, default true                                                       |
| audit columns | `created_at/by`, `updated_at/by`                                            |

Indexes: unique (`company_id`, `list`, `name_key`); (`company_id`, `list`, `active`, `position`).

## API Requirements

- `GET /api/v1/workforce/lists/{list}?includeInactive=` → `{ items: [{ id, name, seedKey, active, position, usage }] }` (`usage` only for list managers).
- `POST /workforce/lists/{list}` `{ name }`; `PATCH …/{itemId}` `{ name }`; `POST …/{itemId}/move` `{ direction }`; `POST …/{itemId}/deactivate`; `POST …/{itemId}/reactivate`; `DELETE …/{itemId}`.

## UI Requirements

- Same list pattern as the project structure (menu with Move up / down, works by touch and keyboard).
- Pickers elsewhere are searchable selects showing active items in order.

## Error Handling

| Case                         | Response                     |
| ---------------------------- | ---------------------------- |
| Name taken                   | `409 LIST_ITEM_NAME_TAKEN`   |
| Delete a used or seeded item | `409 LIST_ITEM_IN_USE`       |
| Choosing an inactive item    | `422 LIST_ITEM_INACTIVE`     |
| Limit reached                | `422 LIST_LIMIT_REACHED`     |
| Read-only company            | `403 SUBSCRIPTION_READ_ONLY` |

## Notifications

None.

## Audit Requirements

`workforce.list_item.created`, `.renamed` (old and new), `.moved`, `.deactivated`, `.reactivated`, `.deleted`.

## Acceptance Criteria

- A new company sees the ten job positions and six competencies in Arabic for an Arabic user and in English for an English user.
- Renaming "Driver" to "Heavy vehicle driver" shows the new name in both languages.
- A used position can't be deleted, only deactivated; it disappears from the picker but stays on the profiles that use it.

## Test Scenarios

- **Positive:** seed for new and existing companies; add, rename, move, deactivate, reactivate, delete unused.
- **Negative:** duplicates (including inactive); deleting used or seeded items; inactive item chosen on a record; limit; caller without permission; read-only company; another company's item id.

## Future Improvements

Grouping competencies by category; competency levels; required competencies per job position (auto-check at assignment); a list of contractor companies.
