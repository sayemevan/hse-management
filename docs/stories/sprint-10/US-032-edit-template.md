# US-032 — Edit Template

| Field    | Value                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                      |
| Priority | Must                                                                             |
| Status   | Approved                                                                         |
| Sources  | Product Book Doc 14, Doc 10 §4, §18, §20; T-76, T-77; O-141, O-147, O-149, O-151 |

## Business Goal

Checklists improve over time, but "previous inspections must continue using the template version that was active when they were created" and "historical inspections must remain unchanged even if templates evolve" (Doc 10 §4, §18).

## User Story

As an **HSE Manager**, I want to change a published template as a new version, see its earlier versions, and retire templates we no longer use, so that inspections improve without rewriting history.

## Description

A published version is never edited (T-76). **Edit** on an active template creates a **draft** v(n+1) as a copy of the current version (item keys kept), opened in the same builder as US-031. While the draft exists, inspectors keep using v(n). **Publish** makes v(n+1) current and marks v(n) **superseded**; inspections already on v(n) — in any status — stay on it (T-77). **Discard draft** deletes the draft.

The builder shows what changed since the published version (added, removed, changed items, as text badges). Removing an item from the draft only affects inspections started on the new version.

**Versions** lists every published version with date, publisher and how many inspections use it; each opens read-only.

**Retire** stops new inspections with the template (online immediately; offline ones as O-147); existing inspections are untouched. **Reactivate** a retired template (name must still be unique among active ones). **Duplicate** creates a new template whose draft v1 copies the current version with **new** item keys (a different template, not a version).

A template is **never deleted** once published (inspections refer to it). An unpublished template (draft v1 only) can be deleted.

## Actors

Holders of `inspections.templates.manage`.

## Preconditions

- The template exists in the company; company not read-only.

## User Flow

1. Templates → "Daily Site Safety Inspection" → **Edit** → "Changes are saved as version 2. Inspectors keep using version 1 until you publish." The builder opens on the draft.
2. Change an item, add one, remove one → **Publish v2** → "Publish version 2? New inspections will use it. 14 open inspections stay on version 1." → **Publish**.
3. **Versions** → v1 (superseded, 230 inspections) → read-only view.
4. Menu → **Retire** → "Retire this template? Nobody can start new inspections with it. Existing inspections are kept." → **Retire**.

## Functional Requirements

The system shall:

1. Create a draft by copying the current published version's content (keys kept); refuse if a draft exists (`409 TEMPLATE_DRAFT_EXISTS`, the builder opens it instead).
2. Publish a draft as in US-031 and, in the same batch, set the previous version to `superseded` and the template's `current_version_id` to the new one.
3. Never change a published or superseded version (no route accepts it; a database trigger refuses updates of `content` when `state <> 'draft'`).
4. Discard a draft (delete the row); delete a template that was never published.
5. Retire and reactivate (name uniqueness checked on reactivate; `409 TEMPLATE_NAME_TAKEN`).
6. Duplicate with fresh keys and the name "… (copy)".
7. List versions with the number of inspections using each (`InspectionDirectory` count).
8. Expose to the web a change summary between the draft and the published version, computed by item key.

## Validation Rules

As US-031 for content. Retire: none. Reactivate: name uniqueness; the category must be active (otherwise "Choose an active category first").

## Permission Rules

`inspections.templates.manage` (company).

## Database Impact

No new tables. A trigger on `inspection_template_version` refuses `UPDATE` of `content`, `version_no` or `template_id` when the old `state` isn't `draft` (migration with `--custom`), so Doc 10 §18 holds even against a bug.

## API Requirements

- `POST /api/v1/inspection-templates/{id}/draft` → `201` with the new draft.
- `DELETE …/{id}/draft` → `204`; `DELETE …/{id}` → `204` (never published only, otherwise `409 TEMPLATE_IN_USE`).
- `POST …/{id}/retire`, `POST …/{id}/reactivate`, `POST …/{id}/duplicate` → `201`.
- `GET …/{id}/versions` → `[{ versionNo, state, publishedAt, publishedBy, inspectionCount }]`; `GET …/{id}/versions/{versionNo}` → content.

## UI Requirements

- "Draft changes" chip on the list and a banner in the builder with **Publish** and **Discard draft**.
- Change badges: "New", "Changed", "Removed" with icons, never colour alone.
- Retired templates under a **Retired** filter with a "Retired" chip.

## Error Handling

| Case                        | Response                     |
| --------------------------- | ---------------------------- |
| Draft already exists        | `409 TEMPLATE_DRAFT_EXISTS`  |
| Delete a published template | `409 TEMPLATE_IN_USE`        |
| Name taken on reactivate    | `409 TEMPLATE_NAME_TAKEN`    |
| Retired template, start     | `409 TEMPLATE_RETIRED`       |
| Read-only company           | `403 SUBSCRIPTION_READ_ONLY` |

## Notifications

None (inspectors see the new version when they next start; the offline pack's ETag changes).

## Audit Requirements

`inspection_template.draft_created`, `inspection_template.draft_discarded`, `inspection_template.published` (from and to version, counts of added / changed / removed items), `inspection_template.retired`, `inspection_template.reactivated`, `inspection_template.duplicated`, `inspection_template.deleted`.

## Acceptance Criteria

- An inspection In Progress on v1 still shows v1's questions after v2 is published, and its submission is scored on v1.
- v1 can't be changed through any route; a direct update is refused by the trigger in a test.
- Retiring a template removes it from the Start picker; its inspections still open and read normally.
- A second **Edit** while a draft exists opens the existing draft.

## Test Scenarios

- **Positive:** draft from v1, publish v2, versions list with counts, discard, retire, reactivate, duplicate (new keys), delete never-published.
- **Negative:** second draft; edit published content (route and trigger); delete published; reactivate with a taken name; start on retired online; read-only company; without permission.

## Future Improvements

Side-by-side comparison of any two versions; scheduled publishing; moving open inspections to a newer version on request.
