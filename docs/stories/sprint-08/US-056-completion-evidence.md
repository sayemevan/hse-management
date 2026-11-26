# US-056 — Upload Completion Evidence and Complete

| Field    | Value                                                                               |
| -------- | ----------------------------------------------------------------------------------- |
| Epic     | Epic 08 — Action Management (Doc 22 "Upload Completion Evidence")                   |
| Priority | Must                                                                                |
| Status   | Approved                                                                            |
| Sources  | Product Book Doc 14, Doc 13 §10, §11, Doc 22; D-12; T-58, T-62; O-103, O-108, O-109 |

## Business Goal

A completed action carries proof of what was done, so the verifier can judge whether the problem is really fixed (Doc 13 §10 "Completion alone is insufficient", §11).

## User Story

As an **action owner**, I want to mark my action complete with a note and photos of the fix, so that it can be verified and closed.

## Description

**Complete** moves an Open or In Progress action to **Completed** (owner only, T-58). The owner writes a **completion note** and attaches **evidence**; evidence is required for High and Critical actions (O-103). Evidence already added with progress notes counts and is offered for selection, so the owner doesn't upload twice.

A Completed action is shown as "Waiting for verification" and leaves the owner's due reminders (its due state is `done`). It returns to In Progress only if a verifier sends it back (US-057).

## Actors

The owner.

## Preconditions

- Signed in; owner of the action; action Open or In Progress, not voided; project not archived; company not read-only.

## User Flow

1. Action page → **Complete**.
2. Dialog: **What was done?** (required), **Evidence**: files already on the action (select which show the fix) and **Add photos or files** → **Complete**.
3. For a High or Critical action without evidence: "Add at least one photo or document for a High priority action." and Complete stays disabled.
4. The action shows Completed — "Waiting for verification"; verifiers get "Verification needed".

## Functional Requirements

The system shall:

1. Apply Complete per `ACTION_WORKFLOW` (owner; Open or In Progress → Completed) in one conditional update, setting `completed_at` and `progress_percent = 100`.
2. Write an `action_update` of kind `completion` with the note; link newly uploaded files and the selected existing files to it as `evidence`.
3. Require at least one evidence file for High and Critical actions (`422 ACTION_EVIDENCE_REQUIRED`), counting the selected existing files.
4. Apply the file rules of US-055 (O-108).
5. Send `action.verification_needed` per PLT-23 § Notifications.
6. Measure on-time completion for later reports: store whether `completed_at` (company date) was on or before `due_on` (`completed_on_time`).

## Validation Rules

| Field           | Rule                                               | Message                                                                                     |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Completion note | Required, 10–2,000 characters                      | "Describe what was done (at least 10 characters)."                                          |
| Evidence        | ≥ 1 file for High / Critical; file rules of US-055 | `ACTION_EVIDENCE_REQUIRED` "Add at least one photo or document for a High priority action." |

## Permission Rules

Owner only (collaborators can add evidence with progress notes, US-055, but can't complete — O-102).

## Database Impact

`action_update` row of kind `completion`; `action_file` rows linked to it; `action.completed_at`, `action.completed_on_time`.

## API Requirements

- `POST /api/v1/projects/{projectId}/actions/{actionId}/transitions` (multipart: `data` JSON `{ to: 'completed', note, evidenceFileIds?: [] }` + `files[]`) → the action.

## UI Requirements

- Evidence picker shows thumbnails of the action's files with checkboxes; new uploads are selected by default.
- The completion update is highlighted in Updates & evidence with "Completed" and its evidence.
- Dialog full-screen on phone; Arabic right-to-left.

## Error Handling

| Case                                   | Response                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Not the owner                          | `403 FORBIDDEN`                                                             |
| Wrong status / race                    | `409 ACTION_TRANSITION_NOT_ALLOWED`                                         |
| No evidence when required              | `422 ACTION_EVIDENCE_REQUIRED`                                              |
| Note too short                         | `422 VALIDATION_FAILED`                                                     |
| File rules                             | as US-055                                                                   |
| Closed / voided / archived / read-only | `409 ACTION_LOCKED` / `409 PROJECT_ARCHIVED` / `403 SUBSCRIPTION_READ_ONLY` |

## Notifications

`action.verification_needed` (PLT-23 § Notifications).

## Audit Requirements

`action.completed` (note length, evidence file ids, on time or late). Timeline `action.completed`.

## Acceptance Criteria

- The owner completes a Medium action with a note and no files; it shows "Waiting for verification".
- Completing a High action without files is refused; selecting a photo added earlier with a progress note is accepted.
- A collaborator doesn't see Complete and the API refuses it.
- The creator, a Safety Officer, gets "Verification needed"; the owner gets nothing.
- A Completed action no longer counts as overdue and drops out of the owner's digest.

## Test Scenarios

- **Positive:** complete from Open and from In Progress; with new files; with selected existing files; on time and late.
- **Negative:** collaborator, verifier or other user completing; High without evidence; short note; double submit (second gets `409`); voided or closed action; archived project; read-only company.

## Future Improvements

Required evidence rules per action type or company setting; before / after photo pairs; GPS and time stamp on photos.
