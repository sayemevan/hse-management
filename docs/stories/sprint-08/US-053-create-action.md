# US-053 — Create Action

| Field    | Value                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 08 — Action Management (Doc 22 "Create Action", "Set Priority", "Set Due Date")                             |
| Priority | Must                                                                                                             |
| Status   | Approved                                                                                                         |
| Sources  | Product Book Doc 14, Doc 13 §3–6, §9, §16, Doc 22; D-12; T-57, T-59, T-60, T-65; O-97–O-101, O-107, O-111, O-112 |

## Business Goal

Every problem found gets an action with one owner and a deadline the moment it is identified (Doc 13 §2).

## User Story

As a **Safety Officer, Supervisor or Inspector**, I want to create an action on my project with an owner, a priority and a due date, so that the issue is fixed by someone accountable.

## Description

A manual action is created from the project's **Actions** tab (**New action**) or, for a closed action, from **Create follow-up action** (O-97). The action starts **Open**, already assigned to its owner (O-96). Later modules create actions through `ActionEngine.create` with the same rules (PLT-23).

Editing an action after creation (title, description, type, place; priority and due date with a reason) is part of this story for holders of `projects.actions.manage`, while the action is Open or In Progress.

## Actors

Holders of `projects.actions.create` (create); holders of `projects.actions.manage` (edit).

## Preconditions

- Signed in on the company's subdomain; `projects.actions.create` on the project.
- The project accepts records (Mobilization or Active, O-111); the company isn't read-only.

## User Flow

1. Project → **Actions** → **New action** (sheet on phone, page on desktop).
2. Fields: **Title**, **Type** (default Corrective), **Priority** (default Medium), **Owner** (search among eligible users, "Me" first), **Due date** (quick picks: Tomorrow, In 3 days, In a week, In 2 weeks), **Description** (optional), **Where** (optional place picker), **Collaborators** (optional, up to 5).
3. **Create** → the action page opens with "RMX-02-ACT-0012 created and assigned to Ahmed Ali."
4. Follow-up: on a closed action, **Create follow-up action** opens the same form with the title "Follow-up: …", the type, place and description copied, and the source shown as the closed action.
5. Edit (managers): action page → **Edit**; changing priority or due date asks "Why are you changing it?".

## Functional Requirements

The system shall:

1. Create the action with source `manual`, or `action` with the closed action's id for a follow-up (follow-ups only from Closed actions of the same project).
2. Number it with `RecordNumbers.next(projectId, 'action')` in the same batch (T-60, O-98).
3. Check the owner and collaborators are eligible (O-101, US-054 FR-1).
4. Resolve the place through `PlaceDirectory` and store `area_id`, `location_id`, `work_zone_id` consistently; only active places (O-112).
5. Write the action, the owner history row (from none), collaborators, the audit entry, the timeline entry and the `action.assigned` / `action.collaborator_added` notifications in one batch.
6. Return the action with `allowedTransitions` and `can` (PLT-23 API).
7. Edit: title, description, type, place by `projects.actions.manage` while Open or In Progress; priority and due date with a reason (5–500 characters), recorded in the timeline with old and new values; a due-date change notifies owner and collaborators (`action.due_date_changed`).
8. Offer a candidates list (`…/actions/candidates?search=`) of eligible users: active users who can view the project, with their project role, 20 at a time.

## Validation Rules

| Field         | Rule                                                        | Message                                                                                                             |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Title         | Required, 5–150 characters trimmed                          | "Enter a title of at least 5 characters."                                                                           |
| Type          | One of the six types (O-99)                                 | "Choose a type."                                                                                                    |
| Priority      | Low, Medium, High, Critical                                 | "Choose a priority."                                                                                                |
| Owner         | Required; eligible (O-101)                                  | "Choose who is responsible." / `ACTION_OWNER_NOT_ELIGIBLE` "This person can't be assigned actions on this project." |
| Due date      | Required; from today (company time zone) to two years ahead | "Choose a due date." / `ACTION_DUE_DATE_INVALID` "The due date can't be in the past."                               |
| Description   | Up to 4,000 characters                                      | "Description is too long."                                                                                          |
| Where         | Optional; an active place of this project                   | `PLACE_INACTIVE` "This place is no longer active."                                                                  |
| Collaborators | Up to 5; eligible; not the owner                            | `ACTION_COLLABORATOR_LIMIT` / `ACTION_OWNER_NOT_ELIGIBLE`                                                           |
| Change reason | Required when priority or due date change; 5–500 characters | `ACTION_REASON_REQUIRED` "Say why you're changing it."                                                              |

## Permission Rules

- `projects.actions.create` (project, **new**) to create — O-107 defaults: CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE ✓, SV ✓, FM ✓, IN ✓, WK —, CL —, CO —, AU —.
- `projects.actions.manage` (project, **new**) to edit — CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, others —.
- Company-editable.

## Database Impact

`action`, `record_counter` (PLT-23); first rows of `action_owner_history`, `action_collaborator` (US-054).

## API Requirements

- `POST /api/v1/projects/{projectId}/actions` `{ title, type, priority, ownerId, dueOn, description?, place?: { placeId }, collaboratorIds?, followUpOf? }` → `201` with the action.
- `GET /api/v1/projects/{projectId}/actions/{actionId}` → the action with owner, collaborators, place names, source, updates, files, `allowedTransitions`, `can`.
- `PATCH /api/v1/projects/{projectId}/actions/{actionId}` `{ title?, description?, type?, place?, priority?, dueOn?, reason? }`.
- `GET /api/v1/projects/{projectId}/actions/candidates?search=` → `{ users: [{ id, name, projectRole, isCompanyWide }] }`.

## UI Requirements

- One-column form on phone; the place picker is the shared Sprint 6 picker.
- Priority shown with icon and text; Critical asks for no extra confirmation but is highlighted.
- The action page header: number, title, status chip, due badge, priority chip, owner; sections **Details · Updates & evidence · Comments · History** (tabs on phone).
- Arabic right-to-left; number and dates in `<bdi dir="ltr">`.

## Error Handling

| Case                                           | Response                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| Project not accepting records                  | `409 PROJECT_NOT_ACCEPTING_RECORDS`                                     |
| Archived project                               | `409 PROJECT_ARCHIVED`                                                  |
| Owner or collaborator not eligible             | `422 ACTION_OWNER_NOT_ELIGIBLE`                                         |
| Due date out of range                          | `422 ACTION_DUE_DATE_INVALID`                                           |
| Edit on Completed / Verified / Closed / Voided | `409 ACTION_LOCKED` (closed, voided) or `ACTION_TRANSITION_NOT_ALLOWED` |
| Follow-up of an action that isn't closed       | `422 VALIDATION_FAILED`                                                 |
| Read-only company                              | `403 SUBSCRIPTION_READ_ONLY`                                            |
| Invalid input                                  | `422 VALIDATION_FAILED` per field                                       |

## Notifications

`action.assigned` to the owner (unless the creator is the owner), `action.collaborator_added` to each collaborator, `action.due_date_changed` on a later due-date change (PLT-23).

## Audit Requirements

`action.created` (all values), `action.updated` (old and new, with the reason when given). Timeline `action.created`, `action.updated`.

## Acceptance Criteria

- A Supervisor creates "Missing guardrail on level 3", High, owned by a Site Engineer, due in two days, at Block A → Floor 03; it is RMX-02-ACT-0001, Open, and the Site Engineer has a notification.
- The next action on RMX-02 is RMX-02-ACT-0002; the first action on another project is …-ACT-0001.
- A due date of yesterday is refused; a Worker can't create an action; a user who isn't on the project can't be owner.
- Creating on a project in Planning or On Hold is refused with an explanation.
- A Safety Officer changes the due date with a reason; the owner is told and the History shows old and new dates with the reason.

## Test Scenarios

- **Positive:** create with and without optional fields; follow-up; edit each field; candidates search.
- **Negative:** each validation rule; inactive place; place of another project; owner without project access; suspended owner; seven collaborators; Planning / On Hold / Completed / Archived project; read-only company; caller without the permission; another company's project.

## Future Improvements

Templates for common actions; creating several actions at once from a list; company-defined types (O-99).
