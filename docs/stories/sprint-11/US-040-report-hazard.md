# US-040 — Report Hazard

| Field    | Value                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Epic     | Epic 06 — Safety Event Engine (Doc 14; Doc 20 "Epic 05", O-156)                                                                                  |
| Priority | Must                                                                                                                                             |
| Status   | Approved                                                                                                                                         |
| Sources  | Product Book Doc 14, Doc 11 §1–5, §8, §13, Doc 20 "Event Reporting", "Evidence"; D-11; T-85, T-90, T-91; O-162–O-167, O-176, O-177, O-180, O-181 |

## Business Goal

Anyone on site can report an unsafe condition or act in under a minute, with a photo, even without a signal (D-11), so that hazards are fixed before they hurt someone (Doc 11 §1, Doc 20 "encourage fast reporting").

## User Story

As a **Worker** (or anyone on the project), I want to report a hazard from my phone with a photo and where it is, even offline, so that the safety team can deal with it.

## Description

This story builds the **Report** screen that US-041 and US-042 extend. The screen opens on three big buttons — **Hazard**, **Near miss**, **Incident** — (the families, T-85); under each, the company's active types of that family (seeded: Hazard, Unsafe Act, Unsafe Condition). Choosing a hazard-family type shows one short form:

| Field                     | Rule                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Project                   | the current project, or a picker of projects the user can report on (offline: the device's kept projects)         |
| Type                      | pre-selected from the button; changeable within all active types                                                  |
| Title                     | 5–120 characters ("Missing edge protection, level 3 slab")                                                        |
| What did you see?         | description 10–4,000                                                                                              |
| Where                     | Area / Location / Work Zone (optional; required if the type says so), "Add my location" (O-148)                   |
| When                      | occurred at, default now (O-177)                                                                                  |
| How serious could it be?  | proposed severity Low / Medium / High / Critical with the O-166 guidance under each; not below the type's minimum |
| Categories                | 0–3 from the company list (optional for the reporter)                                                             |
| What did you do about it? | immediate action taken, optional ("Put up barrier tape, told the supervisor")                                     |
| Photos                    | up to 20, taken or chosen, compressed on the device (T-74)                                                        |
| Witnesses                 | optional names and contact (O-172) — "Who else saw it?"                                                           |

Above **Send report** the screen states: "Your name will be shown to the project's safety team." (O-180). **Save as draft** keeps an unsent report on this device only (O-157); drafts are listed at the top of My reports.

**Send report** online creates the event (**Reported**, number at once); offline it is queued with its photos and shows "Sent when you're back online" (O-163 notice for serious events). Until a reviewer opens it, the reporter can edit any field and add or remove their photos (also offline).

## Actors

Every holder of `projects.safety_events.report` (all roles except Auditor by default).

## Preconditions

- Signed in on the device (offline: within the 7-day window, O-118); the project accepts records or is On Hold (O-181); the settings pack is on the device for offline use.

## User Flow

1. Home → **Report** (or project → **Report**) → **Hazard** → **Unsafe Condition**.
2. Types the title and description, takes two photos, taps **Add my location**, picks Area "Building A", proposes **High**.
3. **Send report** → "Report sent — RMX-02-EVT-0014. The safety team has been told." (offline: "Saved on this device. It will be sent when you're back online." and the report appears in My reports as "Not yet synced").
4. Later in My reports: status **Reported**, then "Under review"; once closed, the closure summary.

## Functional Requirements

The system shall:

1. Create the event with status Reported, `reported_by` = caller, `reported_severity`, `family` from the type, the number (T-91), audit, activity and the severity notification (O-175) in one batch.
2. Accept a device-made id, `capturedAt`, `Idempotency-Key`; a replay returns the stored event (T-69).
3. Accept photos as `upload` items depending on the create; count them against O-162 (20 at report, 100 per event).
4. Let the reporter update reporter fields and photos while `review_started_at` is null; afterwards `409 SAFETY_EVENT_LOCKED` (photos captured before review started are still accepted, PLT-33).
5. Show the report form from the device pack offline (types, categories, places of kept projects) and refresh the pack online (ETag).
6. Keep unsent drafts only on the device (`drafts` store), listed in My reports, deletable by the user.
7. Set `reported_late` when `received_at` (or `capturedAt` offline) is more than 24 hours after `occurred_at`.

## Validation Rules

Title 5–120; description 10–4,000; immediate action ≤ 2,000; occurred at not in the future (5-minute tolerance) and ≤ 365 days ago (`422 SAFETY_EVENT_TIME_INVALID`); severity ≥ type minimum; 0–3 active categories; type active (or within the offline window); place belongs to the project and is active; up to 20 witness names (name 2–120, contact ≤ 120).

## Permission Rules

`projects.safety_events.report` on the project. Editing: the reporter only, before review starts (`403 SAFETY_EVENT_NOT_REPORTER` for others; `.manage` edits through classification, US-043).

## Database Impact

`safety_event` (PLT-33), `safety_event_category_link`, `safety_event_witness` (names only at report), `safety_event_file`.

## API Requirements

- ⚡ `POST /api/v1/projects/{projectId}/safety-events` `{ id?, typeId, title, description, occurredAt, placeId?, location?, reportedSeverity, categoryIds?, immediateAction?, witnesses? }` → `201` the event.
- ⚡ `PATCH …/safety-events/{id}` `{ baseVersion, …reporter fields }`.
- ⚡ `POST …/safety-events/{id}/files` (multipart, `category: evidence`); `DELETE …/files/{fileId}` (reporter, before review).
- `GET /api/v1/safety-events/offline-pack` (ETag).

## UI Requirements

- Family buttons large (≥ 64 px high), icon and word; the type list follows.
- The whole form fits one scrolling screen on a 375 px phone; **Send report** sticky at the bottom.
- Severity choice as four labelled radio cards with the guidance text, never colour alone.
- Offline banner and the per-report "Not yet synced" chip; photo thumbnails with remove buttons (before review).

## Error Handling

| Case                              | Response                                             |
| --------------------------------- | ---------------------------------------------------- |
| Missing or invalid fields         | `422 VALIDATION_FAILED` with fields                  |
| Time in the future / too old      | `422 SAFETY_EVENT_TIME_INVALID`                      |
| Severity below the type's minimum | `422 SAFETY_EVENT_SEVERITY_BELOW_MINIMUM`            |
| Type inactive (online)            | `422 SAFETY_EVENT_TYPE_INACTIVE`                     |
| Area required                     | `422 PLACE_REQUIRED`                                 |
| Too many photos                   | `422 SAFETY_EVENT_FILE_LIMIT`                        |
| Edit after review started         | `409 SAFETY_EVENT_LOCKED`                            |
| Project closed to records         | `409 PROJECT_NOT_ACCEPTING_RECORDS`                  |
| Read-only company                 | `403 SUBSCRIPTION_READ_ONLY` (offline: waits, O-126) |

## Notifications

`safety_event.reported`, `.high_reported` or `.critical_reported` by the proposed severity (O-175).

## Audit Requirements

`safety_event.reported` (type, severity, photo count, offline metadata), `safety_event.updated`, `safety_event.file_added`, `safety_event.file_removed`.

## Acceptance Criteria

- A Worker reports a hazard with two photos online and sees its number at once.
- The same report made offline is sent on reconnection, once, with both photos, and gets the next number.
- An edit by the reporter after a reviewer opened the report is refused and the reporter is told to comment instead.
- A report proposing Low on a type with minimum High is refused.

## Test Scenarios

- **Positive:** report online and offline; replay; edit before review; photos captured before review arriving after it; draft kept on the device; "Reported late".
- **Negative:** every validation rule; another project's place; Auditor reporting (`403`); edit by another user; read-only company; project Completed.

## Future Improvements

QR code on site posters opening the report for that Area; voice notes (Doc 11 §18); anonymous reporting (O-180); reporting on behalf of another person.
