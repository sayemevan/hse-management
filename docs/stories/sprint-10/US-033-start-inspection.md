# US-033 — Start Inspection

| Field    | Value                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                                                                |
| Priority | Must                                                                                                                       |
| Status   | Approved                                                                                                                   |
| Sources  | Product Book Doc 14, Doc 10 §5, §6, §15, §16; D-11; T-68, T-77, T-80, T-82; O-134, O-137, O-141, O-147–O-150, O-152, O-153 |

## Business Goal

Inspections are planned so that they happen (Doc 10 §15 "Today's Inspections", "Overdue"), and inspectors can start one on site, with or without a signal (D-11).

## User Story

As a **Safety Officer**, I want to plan inspections for my inspectors and start inspections myself on site, so that every area is inspected on time.
As an **Inspector**, I want to see the inspections assigned to me and start one even offline, so that I can work wherever I am.

## Description

This story covers **planning** (Draft), **starting** (In Progress), the project's **Inspections** tab and **My inspections**.

**Plan** (online, `projects.inspections.manage`): template, inspector (users who can conduct on the project), planned date, optional place, note for the inspector. Creates a **Draft** with its number (T-82) and notifies the inspector. A Draft can be edited (template, date, place, note), **reassigned** or **cancelled** (reason).

**Start** (online or offline, `projects.inspections.conduct`):

- from a planned Draft: **Start** → In Progress (the template version current at start is pinned, O-147);
- on the spot: **Start inspection** → template (active, published; from the device pack offline), place (required if the template says so), inspection date (today), weather (optional), **Add my location** (optional, O-148) → In Progress. Offline it gets a device id and "Not yet synced" until it reaches the server (T-68).
- **Follow-up**: on an Approved or Closed inspection, **Start follow-up** pre-fills template and place and records `follow_up_of` (O-134).

**Inspections tab** (project): counts — **Today**, **Overdue**, **In progress**, **To review**, **Open findings** (each a filter) — and cards: number, template name, place, inspector, planned or inspected date, status chip, score, findings count. Filters: status, template, inspector, place, date range, "Mine". Sort: planned date, newest. Offset paging (Sprint 8 pattern).

**My inspections** (header link, offline-capable): **Assigned** (my Drafts by planned date, overdue first), **In progress** (mine, including offline-only ones from the device), **To review** (Submitted inspections on projects where I can approve, not mine). Offline the list shows the last loaded copy plus the device's own inspections, with "Last updated 10:42".

## Actors

Planners (`projects.inspections.manage`), inspectors (`projects.inspections.conduct`), viewers (`projects.inspections.view`).

## Preconditions

- The project accepts records (Mobilization, Active; O-50) for plan and start; not archived.
- At least one active published template.
- Offline start: the user's offline profile is valid (O-118), the project was kept on the device and the templates pack is loaded (PLT-26).

## User Flow

1. Project → **Inspections** → **Plan inspection** → template, inspector, date, place → **Plan**. The card shows "Draft · Planned for 3 Dec".
2. Inspector → **My inspections** → Assigned → the card → **Start**. The capture screen opens (US-034).
3. On the spot: **Start inspection** → template → place → **Start**. Offline the indicator shows "Offline · 1 pending" (PLT-31).
4. Reassign: card menu → **Reassign** → new inspector → **Reassign**. Cancel: **Cancel inspection** → reason → **Cancel inspection**.

## Functional Requirements

The system shall:

1. Plan: create a Draft with number, planner, planned date; check the inspector can conduct on the project (`422 INSPECTION_INSPECTOR_NOT_ELIGIBLE`) and the template is active and published.
2. Start from Draft: only the inspector; pin the current published version; set `started_at` (or `capturedAt` offline).
3. Start on the spot: create In Progress with the caller as inspector; accept a device `id`, `Idempotency-Key` and `X-Captured-At`; accept a superseded version under O-147 (`422 TEMPLATE_VERSION_NOT_ALLOWED` otherwise).
4. Require a place with an Area when the version says so (`422 PLACE_REQUIRED`); refuse inactive places for new inspections.
5. Reassign Drafts and In Progress inspections (online only); notify both inspectors; an offline item of the old inspector syncing afterwards → `403 INSPECTION_NOT_INSPECTOR` (Needs attention, "This inspection was reassigned").
6. Cancel with reason; cancelled inspections leave the open counts and stay findable with "Show cancelled".
7. List with counts in one call (`InspectionDirectory.summaryForProject`), honouring visibility (PLT-32 FR-9).
8. `GET /me/inspections` per tab across the user's projects.

## Validation Rules

| Field           | Rule                                              | Message                                         |
| --------------- | ------------------------------------------------- | ----------------------------------------------- |
| Template        | Active, published                                 | "Choose a template."                            |
| Inspector       | Can conduct inspections on this project           | "This person can't carry out inspections here." |
| Planned date    | Today or later on plan; up to 1 year ahead        | "Choose a date from today."                     |
| Inspection date | Not after today (device date offline, O-129)      | "The inspection date can't be in the future."   |
| Place           | Active place of the project; Area required if set | "Choose an area." / "Choose an active place."   |
| Weather         | One of the O-148 values                           | —                                               |
| Note / notes    | Up to 2,000                                       | "Too long."                                     |
| Cancel reason   | 5–500                                             | "Say why the inspection is cancelled."          |

## Permission Rules

- Plan, edit Draft, reassign, cancel any: `projects.inspections.manage` (**new**). Cancel own unplanned: the inspector.
- Start: `projects.inspections.conduct` (**new**); from a Draft, only its inspector.
- Tab: `projects.inspections.view` (**new**) for all; without it, only own (inspector or planner).
- Defaults: see O-149.

## Database Impact

`inspection` as in PLT-32. No other table.

## API Requirements

- `POST /api/v1/projects/{projectId}/inspections` `{ mode: 'plan', templateId, inspectorId, plannedOn, placeId?, note? }` → `201` Draft.
- `POST /api/v1/projects/{projectId}/inspections` `{ mode: 'start', id?, templateVersionId, placeId?, inspectedOn, weather?, location? }` ⚡ → `201` In Progress.
- `PATCH …/inspections/{id}` (Draft fields; In Progress header fields ⚡, `baseVersion`).
- `POST …/inspections/{id}/transitions` `{ to: 'start' | 'reassign' | 'cancel', inspectorId?, reason? }`.
- `GET …/inspections?…` → `{ counts, items, total }`; `GET /api/v1/me/inspections?tab=`.

## UI Requirements

- Start screen: big template cards with category and item count; a search box when there are more than eight.
- Location: "Add my location" asks the browser only when tapped; shows accuracy ("± 12 m").
- Count tiles as buttons with numbers and words; Overdue with an icon.
- Offline: templates and places from the device; "Not yet synced" chip; online-only actions (plan, reassign, cancel) hidden with a short note.

## Error Handling

| Case                      | Response                                    |
| ------------------------- | ------------------------------------------- |
| Inspector not eligible    | `422 INSPECTION_INSPECTOR_NOT_ELIGIBLE`     |
| Template retired          | `409 TEMPLATE_RETIRED`                      |
| Version not allowed       | `422 TEMPLATE_VERSION_NOT_ALLOWED`          |
| Place required / inactive | `422 PLACE_REQUIRED` / `409 PLACE_INACTIVE` |
| Not the inspector         | `403 INSPECTION_NOT_INSPECTOR`              |
| Project not accepting     | `409 PROJECT_NOT_ACCEPTING_RECORDS`         |
| Read-only company         | `403 SUBSCRIPTION_READ_ONLY`                |

## Notifications

`inspection.assigned`, `inspection.unassigned`, `inspection.cancelled`, `inspection.overdue` (PLT-32).

## Audit Requirements

`inspection.planned`, `inspection.updated`, `inspection.started` (offline metadata), `inspection.reassigned`, `inspection.cancelled`.

## Acceptance Criteria

- A Safety Officer plans an inspection for an Inspector, who is notified and sees it under **Assigned**; the next day unstarted, it is **Overdue · 1 day** and both are notified once.
- An Inspector with no connection starts an on-the-spot inspection from a kept project; it syncs later with the next number and appears on the tab.
- A Supervisor without `projects.inspections.view` sees only their own inspections on the tab.
- After reassignment, the first inspector's offline changes are refused with a clear reason and nothing is applied.

## Test Scenarios

- **Positive:** plan, edit, start from Draft, on-the-spot online and offline, follow-up, reassign, cancel, counts, filters, My inspections tabs.
- **Negative:** each validation rule; ineligible inspector; retired template; version outside the window; place required; project On Hold or archived; read-only company; another project's place or template version; replay of the start (one record).

## Future Improvements

Recurring plans; planning in bulk for several areas; a calendar view; QR codes at locations to start an inspection.
