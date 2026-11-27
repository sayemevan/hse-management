# US-035 — Upload Inspection Photos

| Field    | Value                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                                     |
| Priority | Must                                                                                            |
| Status   | Approved                                                                                        |
| Sources  | Product Book Doc 14, Doc 10 §8, §10, §14, §18; D-11, D-28; T-18, T-69, T-74, T-83; O-121, O-136 |

## Business Goal

Evidence makes an inspection credible: "Every failed item should support evidence" and "Evidence should remain linked permanently to the inspection" (Doc 10 §10, §18). Sites often have no signal, so photos are taken offline (D-11).

## User Story

As an **Inspector**, I want to take photos for an item or attach documents to the inspection, with or without a connection, so that each finding is backed by evidence.

## Description

On each item card, **Add photo** opens the camera (or the photo library); up to **5 photos per item**. On the inspection header, **Attachments** takes photos and PDF documents (drawings, certificates), up to **20**; at most **150 files per inspection** (O-136).

Photos are **compressed on the device** (JPEG, ≤ 2,560 px, EXIF removed, T-74) and stored in the device store with their capture time. Each is queued as an `upload` item depending on the inspection's create (T-80) and sent to the inspection's file route with an `Idempotency-Key`, so a photo sent twice is stored once. PDFs are not compressed (≤ 10 MB).

Thumbnails show on the card at once; a full-screen viewer opens on tap (preview before download, Doc 10 §14). While In Progress the inspector can **remove** their own file (it disappears from the inspection; the file is kept and the removal is audited). After submit, files are **permanent**: nobody removes them (Doc 10 §10), a reviewer who returns the inspection lets the inspector add more but not remove those already submitted.

Storage: files count against the plan's storage on arrival (D-28); over the limit the upload is refused and stays in Needs attention ("Your company's storage is full").

## Actors

The inspector (add, remove before submit); viewers (see, download).

## Preconditions

- The inspection is In Progress; the caller is its inspector.
- Offline: the device has room (O-120: new photos refused at 95 % of quota).

## User Flow

1. Item "No trip hazards" (Fail) → **Add photo** → camera → the thumbnail appears with "Saved on this device" when offline.
2. Header → **Attachments** → **Add file** → a PDF drawing.
3. Tap a thumbnail → viewer → **Remove** → "Remove this photo?" → **Remove**.

## Functional Requirements

The system shall:

1. Accept `multipart/form-data` on `POST …/inspections/{id}/files` with `itemKey?`, through the file service, category `inspection_evidence`, with `idempotent()` (T-83).
2. Accept JPEG, PNG, WebP and PDF up to 10 MB (checked by content, not name); enforce 5 per item, 20 on the header, 150 per inspection (`422 INSPECTION_FILE_LIMIT`) counting only files not removed.
3. Store the link in `inspection_file` with the item key, `captured_at` and uploader.
4. Remove (soft) only while In Progress, only files the caller uploaded **after the last submit** (`409 INSPECTION_LOCKED` otherwise).
5. Serve files only to callers who can view the inspection, with the same headers as action files (Sprint 8).
6. Refuse items keys not in the pinned version.

## Validation Rules

| Field     | Rule                                   | Message                                                   |
| --------- | -------------------------------------- | --------------------------------------------------------- |
| File type | JPEG, PNG, WebP, PDF                   | "Use a photo (JPEG, PNG, WebP) or a PDF."                 |
| Size      | 1 byte – 10 MB                         | "This file is larger than 10 MB." / "This file is empty." |
| Count     | 5 per item, 20 on header, 150 in total | "You can add up to 5 photos to an item."                  |

## Permission Rules

Inspector with `projects.inspections.conduct`; viewers with `projects.inspections.view` or own.

## Database Impact

`inspection_file`: `id`, `company_id`, `inspection_id`, `item_key` (nullable), `file_id` (file service), `captured_at`, `submitted_with` (the submit count when it was first submitted; null before), `removed_at`, `removed_by`, audit columns. Index (`inspection_id`, `item_key`).

## API Requirements

- `POST /api/v1/projects/{projectId}/inspections/{id}/files` ⚡ (multipart: `file`, `itemKey?`, `id?`) → `201` `{ id, fileId, itemKey, name, size, contentType }`.
- `DELETE …/files/{inspectionFileId}` → `204`.
- `GET …/files/{inspectionFileId}` → the file (inline for images and PDF).

## UI Requirements

- Thumbnails in a row with a count ("2 of 5"); the add button hides at the limit.
- Upload state per photo: "Saved on this device", "Uploading", "Uploaded", "Needs attention" (icons and words).
- Camera opened with `accept="image/*" capture="environment"`; library choice also offered.

## Error Handling

| Case                | Response                                                      |
| ------------------- | ------------------------------------------------------------- |
| Type or size        | `422 FILE_TYPE_NOT_ALLOWED` / `FILE_TOO_LARGE` / `FILE_EMPTY` |
| Count               | `422 INSPECTION_FILE_LIMIT`                                   |
| Storage full        | `422 PLAN_LIMIT_REACHED`                                      |
| Remove after submit | `409 INSPECTION_LOCKED`                                       |
| Read-only company   | `403 SUBSCRIPTION_READ_ONLY`                                  |

## Notifications

None.

## Audit Requirements

`inspection.file_added` (item key, size, type), `inspection.file_removed`; offline metadata; a replayed upload writes nothing.

## Acceptance Criteria

- Two photos taken offline on a failed item upload once each after reconnecting, appear on the item, and count once against storage.
- A photo can't be removed after submit, also after the inspection is returned.
- A sixth photo on an item is refused on the device and by the API.
- A viewer without the project permission can't download a file by id.

## Test Scenarios

- **Positive:** item photo, header PDF, removal before submit, replay (one file), viewer download.
- **Negative:** each type/size/count rule; remove after submit; not the inspector; storage full; read-only company; another inspection's file id.

## Future Improvements

Videos (Q-32); photo annotation (arrows, circles); automatic GPS stamp as a visible overlay.
