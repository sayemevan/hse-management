# US-058 — Close Action

| Field    | Value                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| Epic     | Epic 08 — Action Management (Doc 22 "Close Action")                                      |
| Priority | Must                                                                                     |
| Status   | Approved                                                                                 |
| Sources  | Product Book Doc 14, Doc 13 §7, §16, Doc 22; D-12; T-58; O-96, O-97, O-105, O-107, O-109 |

## Business Goal

A verified action is closed and frozen as a permanent record of the problem and its fix (Doc 13 §2 "No action should disappear without traceability", §16 "Closed actions become read-only").

## User Story

As an **HSE Manager, Safety Officer or Project Manager**, I want to close a verified action, so that the record is final and only open work remains in the lists.

## Description

- **Close** moves a **Verified** action to **Closed** (`projects.actions.close`). The closer may be the verifier.
- **Verify and close** does both steps at once for a user holding both permissions who isn't a participant (O-105): two updates and two timeline entries, one notification (`action.closed`).
- A closed action is **read-only**: details, owner, collaborators, updates, files and the comment thread (O-105, PLT-22). It can't be reopened (O-97); the only action left is **Create follow-up action** (US-053).
- Closed actions leave the default lists and appear under the **Closed** chip and filter (PLT-24).

## Actors

Holders of `projects.actions.close`.

## Preconditions

- Signed in; `projects.actions.close` on the project; action Verified (or Completed for Verify and close, with the verify rules); project not archived; company not read-only.

## User Flow

1. Action page of a Verified action → **Close** → optional closing note → **Close action**.
2. Or on a Completed action, for holders of both permissions: **Verify and close** → the Verify dialog (US-057) with **Verify and close**.
3. The page shows a "Closed on 24 Nov 2026 by Sara Omar" banner, all controls gone, and **Create follow-up action**.

## Functional Requirements

The system shall:

1. Apply Close per `ACTION_WORKFLOW` (Verified → Closed) in one conditional update, setting `closed_at`, `closed_by`; write an `action_update` of kind `closure`.
2. Apply Verify and close (Completed → Verified → Closed) in one batch with both updates, when the caller holds both permissions and isn't a participant.
3. Lock the action: every later write on it or its comments returns `409 ACTION_LOCKED` / `COMMENTS_LOCKED`.
4. Stop all reminders for it.
5. Send `action.closed` to the owner, collaborators and creator.
6. Show follow-ups made from it ("Follow-up: RMX-02-ACT-0061") with their status.

## Validation Rules

| Field | Rule                             | Message             |
| ----- | -------------------------------- | ------------------- |
| Note  | Optional, up to 2,000 characters | "Note is too long." |

## Permission Rules

`projects.actions.close` (project, **new**) — O-107 defaults: CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE —, SV —, FM —, IN —, WK —, CL —, CO —, AU —. Company-editable. Verify and close also needs `projects.actions.verify` and the not-a-participant rule.

## Database Impact

`action_update` row of kind `closure`; `action.closed_at`, `closed_by`.

## API Requirements

- `POST /api/v1/projects/{projectId}/actions/{actionId}/transitions` `{ to: 'closed', note? }` from Verified.
- `POST …/transitions` `{ to: 'closed', verify: { method, note?, evidenceFileIds? } }` from Completed (Verify and close).

## UI Requirements

- Closed banner with date and closer; read-only page; follow-up list.
- Arabic right-to-left; dates in `<bdi dir="ltr">`.

## Error Handling

| Case                              | Response                                              |
| --------------------------------- | ----------------------------------------------------- |
| No permission                     | `403 FORBIDDEN`                                       |
| Not Verified (Close) / race       | `409 ACTION_TRANSITION_NOT_ALLOWED`                   |
| Verify and close by a participant | `422 ACTION_VERIFIER_IS_PARTICIPANT`                  |
| Any write after closing           | `409 ACTION_LOCKED`                                   |
| Archived / read-only              | `409 PROJECT_ARCHIVED` / `403 SUBSCRIPTION_READ_ONLY` |

## Notifications

`action.closed` (owner, collaborators, creator). Not to the actor.

## Audit Requirements

`action.closed` (note length; `verifiedInSameStep` when Verify and close). Timeline `action.closed`.

## Acceptance Criteria

- A Project Manager closes a Verified action; it is read-only, the comment box is gone, and edits, files and comments are refused by the API.
- An HSE Manager uses Verify and close on a Completed action; the History shows Verified and Closed.
- Closing a Completed action with Close alone is refused (verification first, Doc 13 §16).
- Create follow-up action on the closed action creates a linked Open action; both pages show the link.

## Test Scenarios

- **Positive:** close; Verify and close; follow-up from a closed action.
- **Negative:** close from Open / In Progress / Completed; user without permission; Verify and close by the owner; writes, files, collaborators and comments after closing; archived project; read-only company.

## Future Improvements

Archiving long-closed actions out of default searches (Doc 13 §7 "Archived"); closure sign-off by the client on client-visible actions.
