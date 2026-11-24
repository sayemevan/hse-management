# US-020 — Manage Locations

| Field    | Value                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| Epic     | Epic 02 — Company & Project Management (Doc 17 "Project Structure")              |
| Priority | Must                                                                             |
| Status   | Approved                                                                         |
| Sources  | Product Book Doc 14, Doc 06 §6, §8, §16, Doc 08 §7; T-38, T-39; O-56, O-59, O-60 |

## Business Goal

Each Area holds Locations (Floor 01, Basement, Roof, Mechanical Room) that identify where work actually happens (Doc 06 §6), so a hazard reported "in Block A" can be narrowed to "Block A · Basement".

## User Story

As a **Project Manager or Safety Officer**, I want to add locations inside each area, so that records can say precisely where on the site something happened.

## Description

On the **Structure** tab, each area has **Add location**. Locations follow every shared place rule in [US-019 § Description](US-019-manage-areas.md#description): name and optional code unique within their area, manual order, deactivate instead of delete once used or once they have work zones.

## Actors

Holders of `projects.structure.manage`; every holder of `projects.view` (read).

## Preconditions

- As US-019, and the parent area exists in the same project and is **active**.

## User Flow

1. On an area → **Add location** → name, short code (optional), description (optional) → **Save**. The location appears last under the area, which expands.
2. A location's menu: **Edit**, **Move up**, **Move down**, **Add work zone**, **Deactivate** / **Reactivate**, **Delete**.
3. Inactive areas show no **Add location**.

## Functional Requirements

The system shall:

1. Create a location under an active area of the same project (`level: 'location'`, `parentId` = the area), last in order.
2. Refuse a parent that isn't an area of this project (`PLACE_LEVEL_INVALID`) or is inactive (`PLACE_INACTIVE`).
3. Apply US-019 FR-3 to FR-9 (edit, move, deactivate with work zones, reactivate under an active area only, delete when unused, limit of 200 per area, archived and read-only checks, audit and timeline).
4. Keep names and codes unique within the area only: "Floor 01" may exist in Block A and Block B.

## Validation Rules

As US-019, with the message "Another location in this area already has this name."; `parentId` required and must be an active area of the project.

## Permission Rules

As US-019 (`projects.view` to read, `projects.structure.manage` to change).

## Database Impact

None beyond the shared `place` table (US-019).

## API Requirements

`POST /api/v1/projects/{projectId}/places` `{ level: 'location', parentId, name, code?, description? }`; the other place routes as US-019.

## UI Requirements

As US-019. Locations are indented under their area; the area row shows "{n} locations".

## Error Handling

As US-019, plus `409 PLACE_INACTIVE` when the area is inactive and `422 PLACE_LEVEL_INVALID` when the parent isn't an area of the project.

## Notifications

None.

## Audit Requirements

As US-019 (`place.*` with `level: 'location'` and the parent area in the entry).

## Acceptance Criteria

- "Floor 01" can be added to Block A and to Block B; a second "floor 01" in Block A is refused.
- A location can't be added under an inactive area or under another project's area.
- Deactivating a location deactivates its work zones; reactivating it leaves them inactive.
- Reactivating a location under an inactive area is refused with the reason.

## Test Scenarios

- **Positive:** create, edit, move, deactivate, reactivate, delete a location; same name in two areas.
- **Negative:** parent is a work zone, a location, another project's area, or inactive; duplicates; 201st location in an area; archived project; read-only company; caller without the permission.

## Future Improvements

As US-019 (move to another area, import, templates).
