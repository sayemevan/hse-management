# US-025 — Assign Workforce to Projects

| Field    | Value                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Project Assignment": assign, change, remove)                     |
| Priority | Must                                                                                                     |
| Status   | Approved                                                                                                 |
| Sources  | Product Book Doc 14, Doc 09 §5, §17, Doc 18; D-44 (O-50, O-53); T-45, T-55, T-56; O-76, O-78, O-92, O-93 |

## Business Goal

Each project must know who works on it, in which position and for how long, and that history must stay available for audits (Doc 09 §5, §17). Later modules (permits, toolbox talks) pick people from the project's workforce.

## User Story

As a **Project Manager or Safety Officer**, I want to assign people to my project, change their assignment and end it, so that the project's workforce is always up to date.

## Description

The project gets a **Workforce** tab next to Members. **Members** (US-022) are users with access to the system; **Workforce** are the people working on the site, with or without a login (O-93). A person can be assigned to several projects at the same time (Doc 09 §5) but has at most one open assignment per project (T-55).

**Assignment state** (derived from dates, T-55):

| State     | Rule                                             |
| --------- | ------------------------------------------------ |
| Upcoming  | start date after today                           |
| Current   | started, and no end date or end date ≥ today     |
| Ended     | end date before today                            |
| Cancelled | an upcoming assignment withdrawn (never started) |

**Rules:**

- New assignments only for people whose status is **Active** or **On Leave** (O-78) and who aren't archived.
- New assignments only on projects that aren't **Completed** or **Archived**; Planning and Mobilization are allowed so teams can be prepared. Archived projects are read-only (O-53).
- **End** sets the end date (today by default, or a date in the last 30 days, not before the start). **Cancel** is only for upcoming assignments. Nothing is deleted.
- **Change** edits position, end date and note; the start date can change only while upcoming.
- Two assignments of one person on the same project can't overlap.

## Actors

Holders of `projects.workforce.view` (read) and `projects.workforce.manage` (change) on the project; holders of `workforce.view` (a person's assignments on their profile).

## Preconditions

- Signed in on the company's subdomain; the project belongs to the company.
- To change: `projects.workforce.manage` on the project, the project accepts the change (rules above), and the company isn't read-only.

## User Flow

1. Open a project → **Workforce**: filters (Current — default, Upcoming, Ended, All; Position; Needs attention), search; rows show photo, name, position on this project, from–until, state, compliance badge (PLT-20).
2. **Assign people** → search the company's assignable people (name, employee ID, position, employer, badge; already-assigned people marked "On this project") → tick one or more (up to 50) → position (pre-filled from each profile when one person; one position for all when several, or "Use each person's position"), start date (default today), end date (optional), note → **Assign**.
3. If any person can't be assigned, nothing is saved and the dialog lists who and why ("Mohammed Saleh is suspended", "Omar Khan is already assigned from 1 Dec").
4. Row menu: **Change**, **End assignment**, **Cancel** (upcoming only), **Open profile** (with `workforce.view`).
5. On the profile, **Assignments** tab: every assignment across projects, newest first, including ended and cancelled.

## Functional Requirements

The system shall:

1. List a project's assignments with the filters, 25 per page, including each person's compliance summary.
2. List assignable candidates: profiles not archived with status Active or On Leave, matching the search (T-52), each marked if already on the project.
3. Create up to 50 assignments in one batch, all or none (O-92), refusing per person: not assignable status, archived, overlap (`BULK_ASSIGN_REFUSED` with one `details` issue per person).
4. Change, end and cancel as in the rules, keeping old values in the audit and timeline.
5. When a person becomes Inactive or Terminated with "end assignments" (US-024), end current and cancel upcoming assignments in the same batch.
6. Write the project timeline entry and the profile History entry for each change (T-56).
7. Notify the linked user (if any) when assigned (PLT-20 covers "ending in 7 days").
8. Expose `availability(memberId, projectId, onDate)` through `WorkforceDirectory` (T-47).

## Validation Rules

| Field      | Rule                                                                                 | Message                                        |
| ---------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| People     | 1–50 profile ids of the company                                                      | "Choose up to 50 people."                      |
| Position   | Active job position (PLT-21)                                                         | "Choose a position."                           |
| Start date | Required; not more than 1 year back                                                  | "Choose a start date."                         |
| End date   | Optional; on or after the start date                                                 | "The end date can't be before the start date." |
| Note       | Optional, up to 200                                                                  | "Note is too long."                            |
| Overlap    | No other non-cancelled assignment of the person on the project overlapping the dates | "{name} is already assigned from {date}."      |

## Permission Rules

- **`projects.workforce.view`** (project, new). Proposed defaults (O-76): CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE ✓, SV ✓, FM ✓, IN ✓, WK —, CL —, CO —, AU ✓.
- **`projects.workforce.manage`** (project, new). Proposed defaults (O-76): CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE —, SV —, FM —, IN —, WK —, CL —, CO —, AU —.
- The candidate list needs only `projects.workforce.manage` (it shows directory fields, not personal data). "Open profile" needs `workforce.view`. All company-editable.

## Database Impact

New table `workforce_assignment`:

| Column                         | Type / rule                      |
| ------------------------------ | -------------------------------- |
| `id`                           | UUID v7                          |
| `company_id`                   | not null                         |
| `workforce_member_id`          | FK `workforce_member`            |
| `project_id`                   | FK `project`                     |
| `job_position_id`              | FK `workforce_list_item`         |
| `start_date`, `end_date`       | dates; `end_date` nullable       |
| `note`                         | nullable                         |
| `cancelled_at`, `cancelled_by` | nullable                         |
| `ended_by`                     | nullable (who ended it)          |
| audit columns                  | `created_at/by`, `updated_at/by` |

Indexes: (`project_id`, `start_date`); (`workforce_member_id`, `project_id`); (`company_id`, `end_date`). No delete.

## API Requirements

- `GET /api/v1/projects/{projectId}/workforce?search=&state=current|upcoming|ended|all&position=&attention=&page=` → `{ items: [{ assignmentId, member: { id, fullName, altName, employeeId, photoUrl, status, compliance }, position, startDate, endDate, state, note }], page, total }`.
- `GET …/workforce/candidates?search=` → 25 people `{ id, fullName, employeeId, position, employer, status, compliance, onProject }`.
- `POST …/workforce` `{ memberIds: [], positionId | 'own', startDate, endDate?, note? }` → `201` `{ created: n }`.
- `PATCH …/workforce/{assignmentId}` `{ positionId?, startDate?, endDate?, note? }`.
- `POST …/workforce/{assignmentId}/end` `{ endDate }`; `POST …/cancel`.
- `GET /api/v1/workforce/{memberId}/assignments` → every assignment with project code and name.

## UI Requirements

- Same layout as the Members tab (cards on phone, table on desktop); dialog full-screen on phone.
- State shown with text and icon; dates in `<bdi dir="ltr">`.
- On a Completed or Archived project the **Assign people** button is hidden and a notice explains why.

## Error Handling

| Case                        | Response                                 |
| --------------------------- | ---------------------------------------- |
| Person not assignable       | `409 WORKFORCE_NOT_ASSIGNABLE`           |
| Overlap                     | `409 WORKFORCE_ASSIGNMENT_OVERLAP`       |
| Some people refused (bulk)  | `422 BULK_ASSIGN_REFUSED` with `details` |
| Project Completed           | `409 PROJECT_CLOSED_FOR_ASSIGNMENT`      |
| Project Archived            | `409 PROJECT_ARCHIVED`                   |
| Cancel a started assignment | `422 VALIDATION_FAILED`                  |
| Read-only company           | `403 SUBSCRIPTION_READ_ONLY`             |

## Notifications

| Type                         | To          | Text                                                       |
| ---------------------------- | ----------- | ---------------------------------------------------------- |
| `workforce.assignment.added` | linked user | "You were assigned to {project} as {position} from {date}" |

Ending assignments are in the daily digest (PLT-20).

## Audit Requirements

`workforce.assignment.created` (one per person, with the bulk size), `.updated` (old and new), `.ended`, `.cancelled`. Project timeline actions `workforce.assigned`, `workforce.assignment_changed`, `workforce.assignment_ended`, `workforce.assignment_cancelled`.

## Acceptance Criteria

- A Project Manager assigns three people to RMX-02 in one step; a fourth who is Suspended makes the whole step fail with his name and reason.
- Ahmed can be current on RMX-02 and RMX-03 at the same time, but not twice on RMX-02 for overlapping dates.
- Ending an assignment moves it to Ended; it stays on the profile's Assignments tab and on the project timeline.
- A Foreman sees the project's workforce without profile links; a Client doesn't see the tab.
- No assignment can be added to a Completed project.

## Test Scenarios

- **Positive:** single and bulk assign; own positions; change; end with a past date; cancel upcoming; state derivation around today; Terminated ending assignments; profile assignment history.
- **Negative:** each validation rule; suspended, inactive, terminated or archived person; overlap; Completed and Archived projects; cancel a current assignment; 51 people; read-only company; caller without the permission; another company's person or project; an assignment id of another project in the URL.

## Future Improvements

Required competencies per position checked at assignment; crews and supervisors; mobilisation checklists; attendance (Doc 09 §18).
