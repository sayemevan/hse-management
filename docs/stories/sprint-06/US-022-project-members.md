# US-022 — Project Members

| Field    | Value                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 02 — Company & Project Management (Doc 17 "Project Members")                                                                |
| Priority | Must                                                                                                                             |
| Status   | Approved                                                                                                                         |
| Sources  | Product Book Doc 14, Doc 06 §11–12, Doc 07 §8, §10, §12, §16, Doc 08 §9–10, §15; US-008; D-44 (O-45–O-48); T-34, T-46; O-66–O-69 |

## Business Goal

Project Managers build and maintain their own site team without waiting for the Company Administrator, while nobody can hand out more access than they hold themselves (O-46). Removing someone from one project never affects their other projects (Doc 08 §10).

## User Story

As a **Project Manager**, I want to add people to my project with the right role and dates, change their role and remove them when they leave, so that the right people can work on my site and no one else can.

## Description

The project's **Members** tab lists who works on the project: people with a **project role** (with role, dates and status) and, in a separate group, the **company-wide roles** that see every project (Company Administrator, HSE Director, HSE Manager, O-45), which can't be changed here. Managers can **Add members** — one or many at once with the same role and dates — and **Change** or **Remove** a member. It uses the same project-role rows and rules as the user page (US-008, T-46).

## Actors

Holders of `projects.members.manage` (O-67: Company Administrator, HSE Director, Project Manager); holders of `projects.members.view` (O-66, read); the people added (notified, PLT-17).

## Preconditions

- Signed in on the company's subdomain; the project belongs to the company and isn't archived (for changes).
- The company isn't read-only (for changes).

## User Flow

**View**

1. Open a project → **Members**. Groups: **Project team** (name, role, From–Until, status chip _Active_ / _Starts on …_ / _Ends on …_) and **Company-wide access** (name, company role, "All projects").
2. Search by name or email; filter by role; **Show past members** lists ended roles.

**Add (one or many)**

1. **Add members** → search the company's active and invited users (O-68); select one or several (up to 50, O-69). People who already have a role on the project, or a company-wide role, are shown but can't be selected ("Already on this project" / "Sees all projects").
2. Choose a **role** — only roles the caller may give are offered (T-46) — and optional **From** and **Until**; Until is required for Client, Consultant and Auditor (O-48).
3. **Add**. All are added, or none with a list of the reasons. Each added person is notified.
4. "Invite someone new" links to **Settings → Users** for holders of `users.invite`.

**Change or remove**

1. A member's menu → **Change** (role, Until) or **Remove** (confirmation "Remove Ali Hassan from RMX-02? Their other projects aren't affected.").
2. The member moves to past members on removal; both are notified (PLT-17 § Events).

## Functional Requirements

The system shall:

1. List members: project roles in force or scheduled (and ended ones with `include=past`), plus users with a company-wide company role, from identity's role rows (T-34). Show name, email, phone (if `users.view` is held, else name only), role, dates, status.
2. List **candidates** for adding: the company's `active` and `invited` users, with a flag for those already on the project or company-wide.
3. Add project roles for 1–50 users in one batch through the `access` module's project-role service (T-46), with every US-008 FR-4 rule: project not archived, role allowed at project scope, one role in force or scheduled per user per project, dates as calendar dates in the company time zone, Until required for Client, Consultant and Auditor.
4. Apply **"no more than you hold"** (O-46, T-46) when the caller lacks `users.roles.assign`: the role's project-scope permissions (after company adjustments) must all be held by the caller on this project — for adding, for the new role when changing, and for the member's current role when changing or removing.
5. Refuse a caller changing or removing **their own** project role from this screen (`CANNOT_CHANGE_OWN_ROLE`); holders of `users.roles.assign` can still do it from the user page.
6. Refuse a bulk add as a whole if any user can't be added (`BULK_ADD_REFUSED` with `params.refused: [{ userId, reason }]`).
7. Change a member's role or Until date by ending the row and inserting a new one (T-34), keeping From; remove by ending the row now.
8. Apply changes on the member's next request (T-32).
9. Write audit entries (US-008 actions with `via: 'project_members'`), timeline entries (PLT-18) and notifications (PLT-17: `project.member.added`, `project.member.joined`, `project.member.role_changed`, `project.member.removed`) in the same batch.
10. Send `project.member.access_ending` three days before a dated role ends and write the "access ended" timeline entry the day after, from the daily job (PLT-17 FR-10, PLT-18 FR-4).
11. Leave invited users' project roles waiting: they apply once the invitation is accepted (as the company role in US-008).

## Validation Rules

| Field / case  | Rule                                                                         | Message                                                                    |
| ------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Users         | 1–50 user ids of this company, `active` or `invited`                         | "Choose at least one person." / "You can add up to 50 people at once."     |
| Role          | Allowed at project scope (PLT-16 list)                                       | "This role can't be given on a project."                                   |
| Role (caller) | Within the caller's own access (T-46)                                        | "You can't give a role with more access than you have."                    |
| From / Until  | As US-008                                                                    | As US-008                                                                  |
| Duplicate     | No role in force or scheduled for the user on this project; not company-wide | "{name} is already on this project." / "{name} already sees all projects." |
| Own role      | Not the caller's own assignment                                              | "You can't change your own role here."                                     |

## Permission Rules

- `projects.members.view` (project, **new**) to see the tab. Proposed defaults (O-66): CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE ✓, SV ✓, FM —, IN —, WK —, CL —, CO —, AU ✓.
- `projects.members.manage` (project, **new**) to add, change and remove. Proposed defaults (O-67): CA ✓, HD ✓, HM —, PM ✓, all others —.
- Both company-editable. `users.roles.assign` (company) lifts the "no more than you hold" rule (T-46).

## Database Impact

None new: `user_role` rows (Sprint 5) with the existing index on `project_id`. Seed rows for the two new permissions (T-30).

## API Requirements

- `GET /api/v1/projects/{projectId}/members?search=&role=&include=past` → `{ team: [{ assignmentId, user: { id, name, email?, phone? }, roleCode, validFrom, validUntil, state }], companyWide: [{ user, companyRoleCode }] }`.
- `GET /api/v1/projects/{projectId}/members/candidates?search=` → `{ items: [{ id, name, email, status, onProject, companyWide }], assignableRoles: [roleCode] }`.
- `POST /api/v1/projects/{projectId}/members` `{ userIds: [..], roleCode, validFrom?, validUntil? }` → `201 { added: [assignment] }`.
- `PATCH /api/v1/projects/{projectId}/members/{assignmentId}` `{ roleCode?, validUntil? }` → the new assignment.
- `DELETE /api/v1/projects/{projectId}/members/{assignmentId}` → `204`.

## UI Requirements

- Members tab (PLT-19); cards at every width, as the other lists (Sprint 5 refinement).
- Add members: full-screen dialog on phone with multi-select search, selected people as removable chips, then role and dates; the role list shows only `assignableRoles`.
- Status chips with text: Active, Starts on {date}, Ends on {date} (within 14 days, amber), Ended.
- Controls hidden without `projects.members.manage`, on archived projects, and on the caller's own row.
- Arabic right-to-left; emails, phones and dates left-to-right.

## Error Handling

| Case                            | Response                            |
| ------------------------------- | ----------------------------------- |
| Role beyond the caller's access | `422 ROLE_EXCEEDS_YOUR_ACCESS`      |
| Own role                        | `422 CANNOT_CHANGE_OWN_ROLE`        |
| Some users can't be added       | `422 BULK_ADD_REFUSED` with reasons |
| Role not allowed on a project   | `422 ROLE_NOT_ALLOWED` (existing)   |
| Archived project                | `409 PROJECT_ARCHIVED`              |
| Read-only company               | `403 SUBSCRIPTION_READ_ONLY`        |
| Assignment of another project   | `404 NOT_FOUND`                     |

## Notifications

`project.member.added`, `project.member.joined`, `project.member.role_changed`, `project.member.removed`, `project.member.access_ending` (PLT-17 § Events).

## Audit Requirements

`user.project_role.assigned`, `user.project_role.changed`, `user.project_role.removed` (existing US-008 actions) with `via: 'project_members'` and, for bulk adds, one entry per user sharing a `batchId`.

## Acceptance Criteria

- A Project Manager adds three Safety Officers in one step; each gets a notification and appears as Active; the timeline shows three "added" entries.
- The same Project Manager can't offer or add a role whose permissions exceed theirs — after the company gives Safety Officer `projects.archive`, Safety Officer disappears from the Project Manager's role list and the API refuses it with `ROLE_EXCEEDS_YOUR_ACCESS`; a Company Administrator can still add it.
- Adding an Auditor without Until is refused; a bulk add where one person is already on the project adds nobody and names that person.
- Removing a member from RMX-02 leaves their role on TWR-01 untouched.
- A Project Manager can't change or remove their own row; an HSE Manager (company-wide) is listed under Company-wide access with no controls.
- A Foreman doesn't see the Members tab and gets `403` from the API.

## Test Scenarios

- **Positive:** single and bulk add; change role and Until; remove; past members; invited user added and active after acceptance; Company Administrator overriding the rule.
- **Negative:** "no more than you hold" for add, change (old and new role) and remove; own row; duplicates; company-wide users; 51 users; user of another company; archived project; read-only company; caller without the permission; assignment id of another project.

## Future Improvements

Workforce people without logins (Sprint 7); membership requests; export of the member list; reminders to the Project Manager before many roles end together.
