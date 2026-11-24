# US-019 — Manage Project Areas

| Field    | Value                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 02 — Company & Project Management (Doc 17 "Project Structure")                                            |
| Priority | Must                                                                                                           |
| Status   | Approved                                                                                                       |
| Sources  | Product Book Doc 14, Doc 06 §1, §5, §8, §14–16, Doc 08 §7, §17; D-44 (O-50, O-53); T-38, T-39; O-56, O-58–O-60 |

## Business Goal

Large projects are divided into Areas (Block A, Warehouse, Utility Area) so that inspections, hazards and permits can be filtered and reported by part of the site (Doc 06 §5, §14).

## User Story

As a **Project Manager or Safety Officer**, I want to set up my project's areas, so that my team can record where each safety activity takes place.

## Description

The project's **Structure** tab shows a tree: Areas, their Locations (US-020) and Work Zones (US-021). This story covers the tree screen, the shared rules for every level, and Areas. Managers add, rename, reorder, deactivate, reactivate and (when unused) delete areas.

**Shared place rules (apply to US-019, US-020 and US-021):**

- Three fixed levels, stored in one `place` table (T-38): an **Area** has no parent; a **Location** belongs to an Area; a **Work Zone** belongs to a Location.
- Each place has a name, an optional short code, an optional description and a manual position among its siblings (O-60).
- A place is **active** or **inactive**. Inactive places are hidden from pickers (US-021) but stay on old records and in the tree under "Show inactive".
- Deactivating a place also deactivates everything under it; reactivating a place reactivates only that place (its children are reactivated one by one, so nothing reappears by surprise). A child can't be reactivated while its parent is inactive.
- A place can be **deleted** only if it has no children (active or inactive) and no record uses it (T-39). Otherwise **Delete** explains why and offers **Deactivate**.
- A place never moves to another parent in Phase 1 (create a new one and deactivate the old one); it only moves up or down among its siblings.
- Archived projects: the structure is read-only (O-53). Every other status, including Planning, allows changes, so a site can be set up before work starts.
- Places limit nothing about access (O-58).

## Actors

Holders of `projects.structure.manage` (O-59: Company Administrator, HSE Director, HSE Manager, Project Manager, Safety Officer); every holder of `projects.view` (read).

## Preconditions

- Signed in on the company's subdomain; the project belongs to the company.
- To change: `projects.structure.manage` on the project, the project isn't archived, and the company isn't read-only.

## User Flow

1. Open a project → **Structure**. Empty state: "No areas yet. Areas divide a large project, for example Block A or Warehouse." with **Add area**.
2. **Add area** → name, short code (optional), description (optional) → **Save**. The area appears last.
3. On an area's menu: **Edit**, **Move up**, **Move down**, **Add location**, **Deactivate** / **Reactivate**, **Delete**.
4. **Deactivate** asks: "Deactivate Block A and its 4 locations and 7 work zones? They won't be offered for new records. Existing records keep them." → **Deactivate**.
5. **Delete** on an area with children: "Block A has locations, so it can't be deleted. Deactivate it instead." Without children: "Delete Block A? This can't be undone." → **Delete**.
6. **Show inactive** toggles inactive places (shown with an "Inactive" chip).

## Functional Requirements

The system shall:

1. Return the project's whole tree in one call (areas, locations, work zones with their order, code, active flag and counts), active only unless `includeInactive=true`.
2. Create an area in the project, last in order, enforcing O-60 uniqueness among active **and** inactive siblings.
3. Edit name, code and description; keep uniqueness.
4. Move a place one position up or down among its siblings (swap positions in one batch).
5. Deactivate a place and all its descendants in one batch; reactivate only the place, refusing while the parent is inactive (`PLACE_INACTIVE`).
6. Delete a place only when it has no children and `PlaceUsage.countRecordsUsing(placeId)` is 0 for every registered module (T-39); otherwise `409 PLACE_IN_USE`.
7. Enforce limits per project: up to **200 areas**, **200 locations per area**, **200 work zones per location**, **5,000 places in total** (`PLACE_LIMIT_REACHED`).
8. Refuse every change on an archived project (`409 PROJECT_ARCHIVED`).
9. Write the audit entry and the timeline entry (PLT-18) in the same batch as each change.
10. Expose `PlaceDirectory` in the project module's contract for later modules: `resolve(projectId, placeId)` → `{ areaId, locationId, workZoneId, names, active }` (T-38), and `register(PlaceUsage)`.

## Validation Rules

| Field          | Rule                                                                                  | Message                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Name           | Required, 2–80 characters after trimming; unique among siblings ignoring case         | "Enter a name." / "Another area in this project already has this name."                 |
| Short code     | Optional, 1–12 characters `A–Z`, `0–9`, `-`; stored upper case; unique among siblings | "Use up to 12 capital letters, numbers or hyphens." / "This code is already used here." |
| Description    | Optional, up to 500 characters                                                        | "Description is too long."                                                              |
| Level / parent | Area: no parent                                                                       | `PLACE_LEVEL_INVALID` (bug in caller)                                                   |

## Permission Rules

- `projects.view` (project) to see the Structure tab and the tree.
- `projects.structure.manage` (project, **new**) for every change. Proposed defaults (O-59): CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE —, SV —, FM —, IN —, WK —, CL —, CO —, AU —. Company-editable.

## Database Impact

New table `place` (shared by US-019–021):

| Column                             | Type / rule                                           |
| ---------------------------------- | ----------------------------------------------------- |
| `id`                               | UUID v7                                               |
| `company_id`                       | not null                                              |
| `project_id`                       | FK `project`, not null                                |
| `level`                            | `area`, `location`, `work_zone`                       |
| `parent_id`                        | FK `place`, null for areas                            |
| `name`                             | text, not null; `name_key` = lower-cased trimmed name |
| `code`                             | text, nullable, upper case                            |
| `description`                      | text, nullable                                        |
| `position`                         | integer, not null                                     |
| `active`                           | boolean, default true                                 |
| `deactivated_at`, `deactivated_by` | nullable                                              |
| audit columns                      | `created_at/by`, `updated_at/by`                      |

Indexes: unique (`project_id`, `parent_id`, `name_key`) — with a coalesced parent for areas; unique (`project_id`, `parent_id`, `code`) where code is not null; (`project_id`, `level`, `active`). No soft delete column: deletion is real and only allowed for unused leaves (T-39).

## API Requirements

- `GET /api/v1/projects/{projectId}/places?includeInactive=true` → `{ areas: [{ id, name, code, description, active, position, locations: [{ …, workZones: [ … ] }] }] }`.
- `POST /api/v1/projects/{projectId}/places` `{ level: 'area', name, code?, description? }` → `201` with the place.
- `PATCH /api/v1/projects/{projectId}/places/{placeId}` `{ name?, code?, description? }`.
- `POST …/places/{placeId}/move` `{ direction: 'up' | 'down' }`.
- `POST …/places/{placeId}/deactivate` → `{ deactivated: n }`; `POST …/reactivate`.
- `DELETE …/places/{placeId}` → `204`.

## UI Requirements

- Tree with expand / collapse per area; each row shows code · name, child count and an "Inactive" chip when relevant.
- Forms as a bottom sheet on phone, a dialog on desktop; Move up / down as menu items (no drag-and-drop needed, works with touch and keyboard).
- Controls hidden without `projects.structure.manage`; on an archived project the tab shows the archived banner and no controls.
- Arabic right-to-left; codes left-to-right.

## Error Handling

| Case                             | Response                                    |
| -------------------------------- | ------------------------------------------- |
| Name or code taken               | `409 PLACE_NAME_TAKEN` / `PLACE_CODE_TAKEN` |
| Delete with children or use      | `409 PLACE_IN_USE`                          |
| Reactivate under inactive parent | `409 PLACE_INACTIVE`                        |
| Limit reached                    | `422 PLACE_LIMIT_REACHED`                   |
| Archived project                 | `409 PROJECT_ARCHIVED`                      |
| Read-only company                | `403 SUBSCRIPTION_READ_ONLY`                |
| Invalid input                    | `422 VALIDATION_FAILED` per field           |

## Notifications

None (structure changes are on the timeline).

## Audit Requirements

`place.created`, `place.updated` (old and new), `place.moved`, `place.deactivated` (with the count of descendants), `place.reactivated`, `place.deleted` (with the deleted values). Matching timeline actions (PLT-18).

## Acceptance Criteria

- A Safety Officer on the project adds Block A and Block B, moves Block B above Block A, and the order is kept after reload.
- "block a" is refused when "Block A" exists, even if Block A is inactive.
- Deleting Block A with a location is refused with the explanation; deactivating it hides it and its children; **Show inactive** shows them.
- A Supervisor sees the tree but no controls; on an archived project nobody sees controls and the API refuses changes.
- Each change appears on the project timeline.

## Test Scenarios

- **Positive:** create, edit, move, deactivate with descendants, reactivate, delete a leaf; tree read with and without inactive.
- **Negative:** each validation rule; duplicates among inactive siblings; limits; delete with children; reactivate under an inactive parent; archived project; read-only company; caller without the permission; another company's project or place id; a place id of another project in the URL.

## Future Improvements

Moving a place to another parent; importing a structure from a spreadsheet; copying a structure from another project (project templates, Doc 08 §18); site drawings and map pins (GIS).
