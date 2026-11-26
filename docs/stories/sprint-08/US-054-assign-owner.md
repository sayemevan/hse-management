# US-054 — Assign Owner and Collaborators

| Field    | Value                                                                               |
| -------- | ----------------------------------------------------------------------------------- |
| Epic     | Epic 08 — Action Management (Doc 22 "Assign Responsible Person")                    |
| Priority | Must                                                                                |
| Status   | Approved                                                                            |
| Sources  | Product Book Doc 14, Doc 13 §8, §16, Doc 22; T-61, T-65; O-101, O-102, O-107, O-109 |

## Business Goal

Every action has exactly one accountable owner at any time, and the history of who owned it is kept (Doc 13 §8, §16).

## User Story

As a **Project Manager or Safety Officer**, I want to reassign an action and add collaborators, so that the right person is accountable and others can help.

## Description

The owner is chosen when the action is created (US-053). This story covers **changing the owner** and **managing collaborators** afterwards, the **ownership history**, and what happens when an owner loses access.

- Reassigning is allowed while the action is Open or In Progress. The status doesn't change.
- A Completed action waiting for verification can't be reassigned (it would change who completed it); a verifier sends it back first.
- Collaborators (up to 5) see the action, comment, add progress notes and evidence, but can't complete it (O-102).
- **Owner lost access** (O-101): the owner keeps the action; lists flag it "Owner has no access" and the project's action managers are told once.

## Actors

Holders of `projects.actions.manage` (owner and collaborators); the **owner** (collaborators only).

## Preconditions

- Signed in on the company's subdomain; the action is Open or In Progress and not voided; the project isn't archived; the company isn't read-only.

## User Flow

1. Action page → owner card → **Change owner** → pick a person (eligible users, with their project role) → **Reason** (required, 5–500) → **Change**.
2. The previous owner is told "RMX-02-ACT-0012 was reassigned to Sara Omar", the new owner "You were assigned RMX-02-ACT-0012".
3. Collaborators card → **Add** (search, up to 5) / **Remove** on a collaborator.
4. Owner card → **Ownership history**: each owner with from / to dates, who changed it and why.

## Functional Requirements

The system shall:

1. Treat a user as **eligible** when the account is active, they belong to the company and can view the project now (project role in force, or a company-wide role, O-45).
2. Change the owner of an Open or In Progress action: update `action.owner_id`, close the previous history row and open a new one with the reason, in one batch with audit, timeline and notifications.
3. Refuse reassigning to the same owner, to an ineligible user, or on a Completed, Verified, Closed or voided action.
4. Add collaborators (eligible, not the owner, not already collaborating, 5 at most); removing one sets `removed_at` / `removed_by`. If a collaborator becomes owner, their collaborator row is removed in the same batch.
5. Let the owner add and remove collaborators; only managers change the owner.
6. Compute `owner.hasAccess` on every read; the daily job sends `action.owner_lost_access` once per action and owner (T-64).

## Validation Rules

| Field         | Rule                                | Message                                                                              |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| New owner     | Required; eligible; not the current | `ACTION_OWNER_NOT_ELIGIBLE` "This person can't be assigned actions on this project." |
| Reason        | Required, 5–500 characters          | `ACTION_REASON_REQUIRED` "Say why you're reassigning it."                            |
| Collaborators | Eligible, ≤ 5, not the owner        | `ACTION_COLLABORATOR_LIMIT` "An action can have up to 5 collaborators."              |

## Permission Rules

- `projects.actions.manage` (project, new) to change the owner and manage collaborators.
- The owner may manage collaborators on their own action.

## Database Impact

`action_owner_history`: `id`, `action_id`, `owner_id`, `from_at`, `to_at` (null for the current owner), `assigned_by`, `reason`. Index (`action_id`, `from_at`).

`action_collaborator`: `action_id`, `user_id`, `added_at`, `added_by`, `removed_at`, `removed_by`. Index (`user_id`, `removed_at`) for My actions; at most one row per user with `removed_at` null (checked by the service).

## API Requirements

- `POST /api/v1/projects/{projectId}/actions/{actionId}/owner` `{ ownerId, reason }` → the action.
- `POST …/collaborators` `{ userIds: [] }` → the collaborator list.
- `DELETE …/collaborators/{userId}` → `204`.
- The action response includes `ownerHistory` (newest first).

## UI Requirements

- Owner and collaborator cards with avatar, name, project role and an "No access" chip when relevant.
- Person picker shared with US-053; dialogs full-screen on phone.
- Arabic right-to-left.

## Error Handling

| Case                                 | Response                                              |
| ------------------------------------ | ----------------------------------------------------- |
| Not eligible / same owner            | `422 ACTION_OWNER_NOT_ELIGIBLE`                       |
| Missing reason                       | `422 ACTION_REASON_REQUIRED`                          |
| Too many collaborators               | `422 ACTION_COLLABORATOR_LIMIT`                       |
| Completed / Verified                 | `409 ACTION_TRANSITION_NOT_ALLOWED`                   |
| Closed / voided                      | `409 ACTION_LOCKED`                                   |
| Archived project / read-only company | `409 PROJECT_ARCHIVED` / `403 SUBSCRIPTION_READ_ONLY` |

## Notifications

`action.assigned` (new owner), `action.unassigned` (previous owner), `action.collaborator_added` (each new collaborator), `action.owner_lost_access` (project action managers, once). Not to the actor.

## Audit Requirements

`action.owner_changed` (from, to, reason), `action.collaborator_added`, `action.collaborator_removed`. Matching timeline entries.

## Acceptance Criteria

- A Project Manager reassigns an In Progress action from a Site Engineer to a Supervisor with a reason; both are told; the status stays In Progress; the ownership history lists both.
- The owner adds two collaborators; a sixth is refused.
- Reassigning a Completed action is refused.
- After the owner's project role ends, lists show "Owner has no access", the managers get one notification, and a manager can reassign.

## Test Scenarios

- **Positive:** reassign; add and remove collaborators by manager and by owner; collaborator promoted to owner; ownership history.
- **Negative:** same owner; ineligible user (other company, suspended, no project access); missing reason; sixth collaborator; Completed / Closed / voided action; owner trying to reassign; archived project; read-only company.

## Future Improvements

Owner acceptance step ("Accepted", Doc 13 §7, dropped in O-96); assigning to a team or a role; escalation to the owner's manager.
