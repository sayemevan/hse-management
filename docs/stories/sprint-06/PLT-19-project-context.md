# PLT-19 — Project Context, Project Switcher and Project Tabs

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| Epic     | Platform enabler                                               |
| Priority | Must                                                           |
| Status   | Approved                                                       |
| Sources  | Product Book Doc 06 §11–12, Doc 07 §8; D-44 (O-55); T-45; O-70 |

## Business Goal

People who work on several sites move between their projects in one tap, and every screen from Sprint 8 onwards knows which project it is recording into, so nothing is filed in the wrong project (Doc 06 §12).

## User Story

As a **user assigned to several projects**, I want to switch between my projects from the header and land where I left off, so that I can work on each site without searching the project list.

## Description

A **project switcher** in the header shows the current project's code (or "Choose project" outside a project). It lists the user's projects (O-70). The project page becomes a set of tabs: **Overview** (Sprint 5 details plus counts of areas, locations, work zones and members), **Structure** (US-019–021), **Members** (US-022) and **Timeline** (PLT-18); tabs the user can't use are hidden. The last project opened is remembered, and Home offers "Continue in {project}".

## Actors

Every company user with `projects.view` on at least one project.

## Preconditions

- Signed in on the company's subdomain.

## User Flow

1. Select the switcher. A list shows the user's non-archived projects (last opened first), each with code, name and status chip; a search box appears when there are more than 8.
2. Choose a project. Its Overview tab opens and the switcher shows its code.
3. Later, Home shows **Continue in RMX-02 · Riyadh Metro**.

## Functional Requirements

The system shall:

1. Return the switcher list: projects where the user holds `projects.view`, not archived, ordered by last opened (current user) then code; at most 100, with search by code or name.
2. Put project pages under `/projects/{id}/…` (web) and project-owned API routes under `/api/v1/projects/{projectId}/…` (T-45). The current project is always the one in the URL.
3. Record the last opened project per user when a project page loads (`PUT /me/last-project`, fire-and-forget; allowed in read-only mode).
4. Show **Continue in {project}** on Home if the last project is still viewable and not archived; otherwise nothing.
5. Show the tabs by permission: Overview (`projects.view`), Structure (`projects.view`), Members (`projects.members.view`), Timeline (`projects.timeline.view`), using `myPermissions` from `GET /projects/{id}` (T-37).
6. Add to the project detail response `counts: { areas, locations, workZones, members }` (active places only; members in force).
7. Provide a web helper `useCurrentProject()` that reads the project from the URL and its `myPermissions`, for later modules.
8. Hide the switcher for System Owners and for users who can view no project.

## Validation Rules

| Field                                 | Rule                        | Message / result        |
| ------------------------------------- | --------------------------- | ----------------------- |
| `projectId` on `PUT /me/last-project` | A project the user can view | `404 NOT_FOUND`         |
| `search`                              | Up to 60 characters         | `422 VALIDATION_FAILED` |

## Permission Rules

`projects.view` (project scope) for every list entry and for remembering the last project.

## Database Impact

New table `user_preference` (`user_id` PK, `last_project_id` nullable, `updated_at`). No foreign key to `project` (identity owns users; same choice as T-34). One row per user, created on first write.

## API Requirements

- `GET /api/v1/projects/switcher?search=` → `{ items: [{ id, code, name, status }], lastProjectId }`.
- `PUT /api/v1/me/last-project` `{ projectId }` → `204`.
- `GET /api/v1/projects/{id}` adds `counts`.

## UI Requirements

- Switcher: a button with the project code in the header (phone: in the top bar next to the menu); opens a sheet (phone) or popover (desktop) with keyboard navigation.
- Tabs: a scrollable tab bar on phone; each tab is its own URL so Back works and links can be shared.
- Overview tab: Sprint 5 details plus four count tiles linking to Structure and Members.
- Arabic right-to-left; project codes left-to-right.

## Error Handling

| Case                            | Response                       |
| ------------------------------- | ------------------------------ |
| Last project no longer viewable | Home shows nothing; no error   |
| Project URL the user can't view | `404` page "Project not found" |

## Notifications

None.

## Audit Requirements

None (navigation, not a business change).

## Acceptance Criteria

- A Safety Officer on two projects sees exactly those two in the switcher; an HSE Manager sees every non-archived project.
- Switching from RMX-02 to TWR-01 opens TWR-01's Overview, and Home then offers "Continue in TWR-01".
- A Supervisor sees Overview, Structure and Members tabs but not Timeline (O-65, O-66 defaults).
- Archived projects don't appear in the switcher but open from the Projects list.

## Test Scenarios

- **Positive:** switcher ordering and search; last-project memory; tab visibility per role; counts.
- **Negative:** another company's project id on `PUT /me/last-project`; project removed from the user after it was remembered; archived last project.

## Future Improvements

Offline cache of the switcher list (Sprint 9); pinning favourite projects.
