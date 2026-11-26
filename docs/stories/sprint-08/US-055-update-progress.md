# US-055 — Update Progress

| Field    | Value                                                                       |
| -------- | --------------------------------------------------------------------------- |
| Epic     | Epic 08 — Action Management (Doc 22 "Progress Tracking")                    |
| Priority | Must                                                                        |
| Status   | Approved                                                                    |
| Sources  | Product Book Doc 14, Doc 13 §7, §11, Doc 22; D-12; T-58, T-62; O-102, O-108 |

## Business Goal

Managers see how far an action has got without chasing the owner, and the steps taken stay on record (Doc 13 §1 "Track progress", §11).

## User Story

As an **action owner**, I want to start the action and record progress with notes and photos, so that my team knows where it stands.

## Description

- **Start** moves an Open action to **In Progress** (owner only, T-58). An owner may also complete straight from Open (US-056).
- **Add progress** records a note, an optional **percent complete** (0–90, in steps of 10; 100 is reserved for Complete) and optional files. Owners and collaborators can add progress while the action is Open or In Progress; adding the first progress note to an Open action by its owner also starts it.
- Progress notes are **immutable** (T-62): a mistake is corrected with another note.
- The latest percent is shown on the action and its card.

## Actors

The owner; collaborators (progress notes and files only).

## Preconditions

- Signed in; owner or collaborator of the action; action Open or In Progress, not voided; project not archived; company not read-only.

## User Flow

1. Action page → **Start** (owner, Open) → status In Progress, "Started" in the updates.
2. **Add progress** → note (required), percent (optional slider / chips), **Add photos or files** (camera on phone) → **Save**.
3. The update appears in **Updates & evidence** with author, time, percent and thumbnails; files open in a viewer.

## Functional Requirements

The system shall:

1. Apply Start per `ACTION_WORKFLOW` (owner, Open → In Progress), setting `started_at`.
2. Store a progress update (`kind = progress`, note, percent) and link uploaded files to it (`action_file.kind = evidence`, T-62).
3. Start the action when its owner adds progress to an Open action (same batch).
4. Upload files through the file-storage service in category `action_evidence` (O-108), refusing beyond 20 files per action (`ACTION_FILE_LIMIT`) or the plan's storage (`PLAN_LIMIT_REACHED`).
5. Serve files only through `GET …/actions/{actionId}/files/{fileId}` after the view check (T-49 pattern); thumbnails for images.
6. Keep the latest percent on the action (`progress_percent`) for lists.
7. Refuse progress on Completed, Verified, Closed or voided actions.

## Validation Rules

| Field   | Rule                                                                 | Message                                                                                              |
| ------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Note    | Required, 3–2,000 characters                                         | "Describe the progress."                                                                             |
| Percent | Optional; 0–90, multiple of 10                                       | "Choose a value between 0 and 90 %."                                                                 |
| Files   | JPEG, PNG, WebP, PDF; ≤ 10 MB each; ≤ 20 per action; ≤ 10 per upload | `FILE_TYPE_NOT_ALLOWED` / `FILE_TOO_LARGE` / `ACTION_FILE_LIMIT` "This action already has 20 files." |

## Permission Rules

Owner (Start, progress); collaborators (progress). No permission code: rights come from the role on the action (PLT-23).

## Database Impact

`action_update` (`id`, `action_id`, `kind` — `start`, `progress`, `completion`, `verification`, `send_back`, `closure`, `void` — `note`, `percent`, `method`, `created_by`, `created_at`); triggers reject UPDATE and DELETE.

`action_file` (`action_id`, `file_id`, `update_id` nullable, `kind`, `added_by`, `added_at`). `action.progress_percent` (integer, nullable).

New file category `action_evidence` (module-served, counts against storage).

## API Requirements

- `POST /api/v1/projects/{projectId}/actions/{actionId}/transitions` `{ to: 'in_progress' }` → the action.
- `POST …/updates` (multipart: `data` JSON `{ note, percent? }` + `files[]`) → `201` with the update and files.
- `POST …/files` (multipart, files only, linked to the latest update of the caller or to none) → the files.
- `GET …/files/{fileId}?thumb=1` → the file with `Cache-Control: private, no-store`.

## UI Requirements

- Updates as a vertical list, newest first, each with icon by kind, author, time, percent and thumbnails.
- Progress bar with the percent and text ("60 %"); never colour alone.
- Upload shows progress per file and lets the user remove a file before saving.
- Arabic right-to-left.

## Error Handling

| Case                     | Response                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Not owner / collaborator | `403 FORBIDDEN`                                                                                     |
| Wrong status             | `409 ACTION_TRANSITION_NOT_ALLOWED`                                                                 |
| Closed / voided          | `409 ACTION_LOCKED`                                                                                 |
| File rules               | `422 FILE_TYPE_NOT_ALLOWED` / `413 FILE_TOO_LARGE` / `422 ACTION_FILE_LIMIT` / `PLAN_LIMIT_REACHED` |
| Archived / read-only     | `409 PROJECT_ARCHIVED` / `403 SUBSCRIPTION_READ_ONLY`                                               |

## Notifications

None for Start or progress notes (they are on the History and visible on the action). Comments notify (PLT-22).

## Audit Requirements

`action.started`, `action.progress_added` (percent, file count), `action.file_added` (file id, size, type). Timeline entries for Start and progress.

## Acceptance Criteria

- The owner starts an Open action; it shows In Progress.
- A collaborator adds "Scaffold ordered, arrives Sunday" at 30 % with a photo; the card shows 30 %.
- A 12 MB photo is refused; a 21st file is refused.
- A Safety Officer who isn't a participant can view the photo; a Worker who isn't on the action gets `404`.
- After the action is closed, Add progress is gone and the API refuses it.

## Test Scenarios

- **Positive:** Start; progress with and without files and percent; owner's first note starting the action; file download and thumbnail.
- **Negative:** non-participant progress; percent 100 or 35; each file rule; storage limit; Completed / Closed / voided action; generic `/files/{id}` refusing the category; archived project; read-only company.

## Future Improvements

Offline progress and photo capture (Sprint 9 sync layer); photo annotation; voice notes (Doc 13 §17).
