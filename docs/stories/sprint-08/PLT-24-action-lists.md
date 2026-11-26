# PLT-24 — Action Lists: Project Actions Tab and My Actions

| Field    | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Epic     | Epic 08 — Action Management (Doc 13 §9, §14; Doc 22 "Action Dashboard")    |
| Priority | Must                                                                       |
| Status   | Approved                                                                   |
| Sources  | Product Book Doc 13 §9, §14, Doc 22; T-45, T-59, T-65; O-101, O-107, O-113 |

## Business Goal

People find the work that needs them today — their overdue and due actions, and the completed actions waiting for their verification — and managers see what is open on each project (Doc 13 §9 "Overdue actions should receive increased visibility", §14).

## User Story

As an **action owner**, I want one page with my actions sorted by urgency, and as a **project manager or safety officer**, I want the project's actions with counts and filters, so that nothing overdue goes unnoticed.

## Description

Two lists on the same API and card design:

- **Project → Actions tab** (T-45: `/projects/{id}/actions`): count chips **Open**, **Overdue**, **Due today**, **To verify**, **Closed**; filters; search; **New action** button.
- **My actions** (`/my-actions`, header link with the overdue count): three tabs across every project the user can view — **Owned**, **Collaborating**, **To verify** (Completed actions on projects where the user holds `projects.actions.verify` and isn't a participant).

The full dashboard (charts, team views, recently completed) and reports are Sprint 18 (O-113).

## Actors

Everyone with `projects.view` (own actions); holders of `projects.actions.view` (all of the project's actions); verifiers (To verify).

## Preconditions

- Signed in on the company's subdomain.

## User Flow

1. Project → **Actions**: chips with counts; select a chip to filter. Default view: not closed, not voided, sorted **overdue first, then by due date, then priority** (Critical first).
2. Filters (sheet on phone): Status, Due (Overdue, Due today, Due soon, On track), Priority, Type, Owner, Place (area / location / work zone), Source, "Owner has no access", "Show voided". Search by number or title.
3. Each card: number, title, priority chip, status chip, due badge, owner name and avatar, place, source label; select → action page.
4. **My actions**: tabs with counts; same cards with the project code; the digest notification opens it filtered to due today and overdue.
5. Empty states: "No actions yet." with **New action** (when allowed); "Nothing needs you today." on My actions.

## Functional Requirements

The system shall:

1. List a project's actions with the filters above, cursor paging of 25, applying T-65: without `projects.actions.view` only the caller's own (owned, collaborating, created).
2. Turn due filters into date ranges in the company's time zone (T-59).
3. Return the summary counts for the chips in one call, with the same access rule.
4. List My actions across projects, only projects the caller can view now, excluding archived projects unless the action is still open.
5. Include on each item: `number`, `title`, `type`, `priority`, `status`, `dueOn`, `dueState`, owner (id, name, `hasAccess`), place names, source label, project code, `voided`.
6. Search by number (`ACT-12`, `12` or the full `RMX-02-ACT-0012`) and by words in the title, case-insensitive, Arabic letters normalised as T-52.
7. Show the overdue count of the caller's owned actions in the header (part of the existing `/auth/me` refresh or a light `GET /me/actions/summary`), refreshed with the notification poll (T-42).

## Validation Rules

Filter values must come from the shared lists; unknown values → `422 VALIDATION_FAILED`.

## Permission Rules

`projects.view` for the tab; contents per T-65. To verify needs `projects.actions.verify` on that project.

## Database Impact

None beyond PLT-23 (its indexes serve these lists).

## API Requirements

- `GET /api/v1/projects/{projectId}/actions?status=&due=&priority=&type=&owner=&place=&source=&noAccess=&voided=&search=&cursor=` → `{ items, nextCursor }`.
- `GET /api/v1/projects/{projectId}/actions/summary` → `{ open, overdue, dueToday, toVerify, closed }`.
- `GET /api/v1/me/actions?tab=owned|collaborating|verify&due=&cursor=` → `{ items, nextCursor, counts }`.
- `GET /api/v1/me/actions/summary` → `{ overdue, dueToday, toVerify }`.

## UI Requirements

- Cards at every width; on desktop the tab may show a table with the same columns.
- Overdue cards show an icon, "Overdue · n days" and a stronger border; never colour alone.
- Filters remembered in the URL query, so a link keeps them.
- Arabic right-to-left; numbers and dates in `<bdi dir="ltr">`.

## Error Handling

| Case                | Response                |
| ------------------- | ----------------------- |
| Project not visible | `404 NOT_FOUND`         |
| Invalid filter      | `422 VALIDATION_FAILED` |

## Notifications

None.

## Audit Requirements

None (reads).

## Acceptance Criteria

- A Worker who owns one action on RMX-02 sees only that action on the Actions tab and in My actions.
- A Safety Officer sees all of RMX-02's actions; the Overdue chip count matches the overdue filter.
- An HSE Manager sees a Site Engineer's completed action under To verify; the Site Engineer, who owns it, doesn't.
- Searching "ACT-7" finds RMX-02-ACT-0007.
- Voided actions appear only with "Show voided".

## Test Scenarios

- **Positive:** each filter, combined filters, paging, summary counts, My actions tabs across two projects.
- **Negative:** another company's project, filters with unknown values, a project the caller can no longer view (its actions leave My actions).

## Future Improvements

Action dashboard with charts, team actions and recently completed (Sprint 18); saved filters; export (Sprint 18 reports).
