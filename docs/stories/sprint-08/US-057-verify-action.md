# US-057 — Verify Action

| Field    | Value                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Epic     | Epic 08 — Action Management (Doc 22 "Verify Completion")                                      |
| Priority | Must                                                                                          |
| Status   | Approved                                                                                      |
| Sources  | Product Book Doc 14, Doc 13 §2, §10, §16, Doc 22; D-12; T-58; O-96, O-97, O-104, O-107, O-109 |

## Business Goal

An authorised person other than the one who did the work confirms the fix is effective, before the action can close (Doc 13 §2 "Every completed action should be verified", §10, §16).

## User Story

As an **HSE Manager or Safety Officer**, I want to verify a completed action, or send it back with a reason, so that only effective fixes are closed.

## Description

- **Verify** moves a Completed action to **Verified**. The verifier holds `projects.actions.verify` and is **not the owner or a collaborator** of that action (O-104). They choose the **verification method** — Photo evidence, Document review, Site visit, Supervisor approval (Doc 13 §10) — and may add a note and their own evidence (for example a photo taken on the site visit).
- **Send back** moves a Completed action back to **In Progress** with a required reason. The owner and collaborators are told; the due date stays unless a manager changes it (US-053), so an overdue action shows as overdue again.
- **Verify and close** (O-105) is US-058.

## Actors

Holders of `projects.actions.verify` who aren't participants of the action.

## Preconditions

- Signed in; `projects.actions.verify` on the project; not the owner or a collaborator; action Completed, not voided; project not archived; company not read-only.

## User Flow

1. My actions → **To verify**, or the "Verification needed" notification → action page with the completion note and evidence on top.
2. **Verify** → **How did you check?** (one of four methods, required) → note (optional) → evidence (optional) → **Verify**.
3. Or **Send back** → **What still needs to be done?** (required) → **Send back**.
4. Participants who hold the permission see "You can't verify an action you worked on." instead of the buttons.

## Functional Requirements

The system shall:

1. Apply Verify per `ACTION_WORKFLOW` (Completed → Verified), setting `verified_at`, `verified_by`, in one conditional update; write an `action_update` of kind `verification` with method, note and evidence links.
2. Apply Send back (Completed → In Progress), clearing `completed_at` and `completed_on_time`, setting `progress_percent` back to the last progress value, writing an `action_update` of kind `send_back` with the reason.
3. Refuse both to the owner and current collaborators (`422 ACTION_VERIFIER_IS_PARTICIPANT`), even when they hold the permission; a collaborator removed before completion may verify.
4. Accept verifier evidence with the file rules of US-055 (counted in the 20).
5. Send `action.verified` (owner and creator) or `action.sent_back` (owner and collaborators).
6. Count how many times an action was sent back (`send_back_count`) for later reports.

## Validation Rules

| Field  | Rule                                                                               | Message                                                     |
| ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Method | Required: `photo_evidence`, `document_review`, `site_visit`, `supervisor_approval` | "Choose how you checked it."                                |
| Note   | Optional, up to 2,000 characters                                                   | "Note is too long."                                         |
| Reason | Send back: required, 10–2,000 characters                                           | `ACTION_REASON_REQUIRED` "Say what still needs to be done." |

## Permission Rules

`projects.actions.verify` (project, **new**) — O-107 defaults: CA ✓, HD ✓, HM ✓, SO ✓, PM —, SE —, SV —, FM —, IN —, WK —, CL —, CO —, AU —. Company-editable. Never the action's owner or collaborators.

## Database Impact

`action_update` rows of kind `verification` (with `method`) and `send_back`; `action.verified_at`, `verified_by`, `send_back_count`.

## API Requirements

- `POST /api/v1/projects/{projectId}/actions/{actionId}/transitions` (multipart or JSON) `{ to: 'verified', method, note?, evidenceFileIds? }` + `files[]`.
- `POST …/transitions` `{ to: 'in_progress', reason }` from Completed (send back).

## UI Requirements

- Completion note and evidence shown first on the verify view, full-screen image viewer with swipe.
- Method as four large options with icons and text.
- Sent-back actions show the reason at the top of the action page for the owner until it is completed again.
- Arabic right-to-left.

## Error Handling

| Case                          | Response                                                                    |
| ----------------------------- | --------------------------------------------------------------------------- |
| No permission                 | `403 FORBIDDEN`                                                             |
| Verifier is a participant     | `422 ACTION_VERIFIER_IS_PARTICIPANT`                                        |
| Not Completed / race          | `409 ACTION_TRANSITION_NOT_ALLOWED`                                         |
| Missing method / reason       | `422 VALIDATION_FAILED` / `ACTION_REASON_REQUIRED`                          |
| Voided / archived / read-only | `409 ACTION_LOCKED` / `409 PROJECT_ARCHIVED` / `403 SUBSCRIPTION_READ_ONLY` |

## Notifications

`action.verified` (owner, creator), `action.sent_back` (owner, collaborators). Not to the actor.

## Audit Requirements

`action.verified` (method, evidence ids), `action.sent_back` (reason). Timeline entries for both.

## Acceptance Criteria

- An HSE Manager verifies a completed action by site visit with a photo; it shows Verified with the method.
- A Safety Officer who is the action's owner can't verify it, in the UI and the API.
- Sending back without a reason is refused; with a reason the action is In Progress, the owner sees the reason and is told, and the action is overdue again if its due date has passed.
- Two verifiers pressing Verify at once: one succeeds, the other gets `409` with the current status.

## Test Scenarios

- **Positive:** verify with each method; with and without note and evidence; send back; complete again after send-back; verify after a removed collaborator.
- **Negative:** owner, collaborator, user without permission; Open / In Progress / Verified / Closed / voided action; missing method; short reason; concurrent verify; archived project; read-only company.

## Future Improvements

Multi-level verification (Doc 13 §17), QR-code site check-in as proof of site visit, verification due dates.
