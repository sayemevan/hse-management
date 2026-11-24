# US-021 — Manage Work Zones and the Shared Place Picker

| Field    | Value                                                                       |
| -------- | --------------------------------------------------------------------------- |
| Epic     | Epic 02 — Company & Project Management (Doc 17 "Project Structure")         |
| Priority | Must                                                                        |
| Status   | Approved                                                                    |
| Sources  | Product Book Doc 06 §7–8, §14, §16, Doc 08 §7; T-38, T-39; O-56, O-59, O-60 |

## Business Goal

Work Zones (Scaffold Zone, Excavation Zone, Crane Zone) are the most precise place on site (Doc 06 §7). Permits, inspections and hazards from Sprint 8 onwards point at them, so one shared **place picker** is delivered now and every later form uses it (O-56).

## User Story

As a **Safety Officer**, I want to mark the work zones inside each location, and pick a place quickly on any form, so that every record shows exactly where the work happened.

## Description

On the **Structure** tab, each location has **Add work zone**. Work zones follow the shared place rules in [US-019 § Description](US-019-manage-areas.md#description). This story also delivers the **place picker** web component and its rules, used later by every operational form.

**Place picker rules (O-56):**

- Optional by default: the field reads "Where? (optional)". A form may require a level (for example "Work Zone required" on a permit), set by that module's spec.
- The user may stop at any level: Area only, Area + Location, or Area + Location + Work Zone. Never a Location without its Area (the picker always fills the parents).
- Only **active** places are offered. A record that already points at an inactive place keeps showing it, marked "(inactive)"; on edit the user may keep it or choose an active one.
- Search across all three levels by name or code ("scaff" finds "Block A › Floor 01 › Scaffold Zone").
- Shown as one line: `Block A › Floor 01 › Scaffold Zone`.

## Actors

Holders of `projects.structure.manage` (set up); every user filling a form in a later module (picker).

## Preconditions

- As US-019, and the parent location exists in the same project and is **active**.

## User Flow

**Set up**

1. On a location → **Add work zone** → name, code (optional), description (optional) → **Save**.
2. A work zone's menu: **Edit**, **Move up**, **Move down**, **Deactivate** / **Reactivate**, **Delete**.

**Pick (later modules; demonstrated in this sprint on a test page in development builds only)**

1. Select **Where?** → a sheet with a search box and the tree of active places.
2. Choose an area, then optionally a location and a work zone, or choose a search result directly.
3. **Done** shows the chosen path; **Clear** removes it.

## Functional Requirements

The system shall:

1. Create a work zone under an active location of the same project (`level: 'work_zone'`), last in order; work zones have no children.
2. Apply US-019 FR-3 to FR-9 (edit, move, deactivate, reactivate under an active location only, delete when unused, 200 per location, archived and read-only checks, audit and timeline).
3. Provide the web component `PlacePicker` (`value: { areaId?, locationId?, workZoneId? }`, `required?: 'area' | 'location' | 'work_zone'`) using the tree endpoint, with client-side search over names and codes.
4. Provide `PlaceDirectory.resolve(projectId, placeId)` and `PlaceDirectory.validateSelection(projectId, { areaId?, locationId?, workZoneId? }, { required?, allowInactiveIds? })` for later modules' services: the three ids must be consistent (each one the parent of the next), belong to the project, and be active unless they are already on the record being edited.
5. Expose shared validation messages for later forms: "Choose where this happened." (when required), "This place is no longer active. Choose another one."

## Validation Rules

As US-019, with the message "Another work zone in this location already has this name."; `parentId` required and must be an active location of the project.

## Permission Rules

As US-019. The picker needs only `projects.view`.

## Database Impact

None beyond the shared `place` table. Later modules add `area_id`, `location_id`, `work_zone_id` (nullable) to their own tables (T-38), with an index on (`project_id`, `area_id`).

## API Requirements

`POST /api/v1/projects/{projectId}/places` `{ level: 'work_zone', parentId, name, code?, description? }`; the other place routes as US-019. The picker uses `GET …/places`.

## UI Requirements

- Work zones are indented under their location; the location row shows "{n} work zones".
- Picker: full-height sheet on phone with large touch targets (field use with gloves, Doc 05), popover on desktop; breadcrumb of the chosen path; keyboard and screen-reader friendly (tree role).
- Arabic right-to-left: the path separator follows the reading direction; codes left-to-right.

## Error Handling

As US-019/US-020. `PlaceDirectory.validateSelection` returns field errors that later modules pass through as `422 VALIDATION_FAILED`.

## Notifications

None.

## Audit Requirements

As US-019 (`place.*` with `level: 'work_zone'`).

## Acceptance Criteria

- A Safety Officer adds "Scaffold Zone" to Block A › Floor 01, and "Scaffold Zone" can also exist under Floor 02.
- A work zone can't be added under an area, under another work zone, or under an inactive location.
- In the development picker page, searching "scaff" shows both Scaffold Zones with their paths; choosing one fills area, location and work zone; choosing only an area is allowed.
- `validateSelection` refuses a location that isn't in the chosen area, a place of another project, and an inactive place (unless allowed for an existing record).

## Test Scenarios

- **Positive:** create, edit, move, deactivate, reactivate, delete a work zone; picker selection at each level; search; inactive place kept on an existing record.
- **Negative:** wrong parent level; inactive parent; inconsistent id triple; another project's ids; required level missing; archived project; read-only company.

## Future Improvements

Zone types with icons (scaffold, excavation, crane) for reports; temporary zones with dates; QR codes on site that pre-fill the picker; map pins (GIS).
