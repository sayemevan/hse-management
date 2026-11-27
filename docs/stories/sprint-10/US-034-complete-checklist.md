# US-034 — Complete Checklist

| Field    | Value                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                                         |
| Priority | Must                                                                                                |
| Status   | Approved                                                                                            |
| Sources  | Product Book Doc 14, Doc 10 §7–9, §13, §18; D-11, D-20; T-70, T-77, T-80, T-81; O-139, O-140, O-155 |

## Business Goal

"Every inspection should be fast, structured, evidence-based" (Doc 10, Final Principle): an inspector walks the site and records each item in a few taps, with a connection or without.

## User Story

As an **Inspector**, I want to go through the checklist section by section, mark each item, add comments and see my progress and score, so that I finish the inspection quickly and correctly on site.

## Description

The **capture screen** (offline-capable) shows the inspection header (number or "Not yet synced", template, place, date) and the sections of the pinned version. Each item is a card with the question, expected condition and guidance (expandable), the **result buttons** the template allows (Pass, Fail, Observation, Not applicable, Not inspected), a **comment** field, **photos** (US-035), the **assigned person** picker (O-155) and, for Fail and Observation, the **priority** (pre-set from the template) and **Raise a finding** (Observation only; Fail always raises one, O-145).

Every change is saved on the device at once and queued as an `inspection_item` upsert (T-80): one request per item, carrying only changed fields and the item's `baseVersion`. Online, the queue sends it within seconds; offline it waits. The header (place, date, weather, notes) is edited the same way as an `inspection` update.

A **progress bar** shows "18 of 32 answered"; section headers show their own count and a "Fail" count. The **live score** (T-81) appears when the template scores. **Jump to next unanswered** and a section index help on long checklists. "Mark the rest of this section Not applicable" (when N/A is allowed) asks for confirmation.

Conflicts (D-20): only when the same item was changed elsewhere since the device saw it (rare: the inspector on two devices); the sync centre review (PLT-30) shows both versions of that item.

## Actors

The inspection's inspector.

## Preconditions

- The inspection is In Progress and the caller is its inspector.
- Online, or offline with a valid offline profile (O-118).

## User Flow

1. Capture screen → section **Housekeeping** → "Walkways clear" → **Pass**.
2. "No trip hazards" → **Fail** → comment "Cables across the corridor at level 2" (required) → photo (US-035) → priority High → assigned person "Ahmed (Electrical foreman)".
3. **Next section** … The score shows "Score 86 % · pass mark 85 %".
4. **Review and submit** (US-036).

## Functional Requirements

The system shall:

1. Upsert an item result by `item_key` (`PUT …/items/{itemKey}`), creating the row on first save with `version` 1; refuse an item key that isn't in the pinned version (`422 INSPECTION_ITEM_UNKNOWN`) and a result the template doesn't allow (`422 VALIDATION_FAILED`).
2. Apply `baseVersion` per item (T-70); a mismatch from an offline request → `409 SYNC_CONFLICT` for that item only.
3. Allow clearing a result (back to unanswered) while In Progress.
4. Accept header updates (place, inspection date, weather, notes, location) with the header's `baseVersion`.
5. Refuse every change unless In Progress and the caller is the inspector (`403 INSPECTION_NOT_INSPECTOR`, `409 INSPECTION_LOCKED`).
6. Compute nothing final while capturing; the score shown is the shared function's result on the device (T-81).
7. Group the item saves of one request into one audit and activity entry.

## Validation Rules

| Field           | Rule                                                                | Message                               |
| --------------- | ------------------------------------------------------------------- | ------------------------------------- |
| Result          | One of the template's allowed results, or null to clear             | —                                     |
| Comment         | Up to 1,000; required on submit for Fail and Not inspected (US-036) | "Add a comment for this item."        |
| Priority        | Low, Medium, High, Critical; only with Fail or Observation          | —                                     |
| Assigned person | A user who can view the project                                     | "This person can't see this project." |
| Raise a finding | Only with Observation                                               | —                                     |

## Permission Rules

The inspector, with `projects.inspections.conduct` on the project at the time of saving (re-checked on sync, T-73).

## Database Impact

`inspection_item_result`: `id`, `company_id`, `inspection_id`, `item_key`, `result` (`pass` / `fail` / `observation` / `not_applicable` / `not_inspected` / null), `comment`, `priority`, `assigned_to`, `raise_finding`, `captured_at`, `version`, audit columns. Unique (`inspection_id`, `item_key`).

## API Requirements

- `PUT /api/v1/projects/{projectId}/inspections/{id}/items/{itemKey}` ⚡ `{ result?, comment?, priority?, assignedTo?, raiseFinding?, baseVersion? }` → the item result.
- `GET …/inspections/{id}` includes `items: [{ itemKey, result, comment, priority, assignedTo, raiseFinding, files, version }]`.

## UI Requirements

- Result buttons at least 48 px high, one row on phone, each with a design-system icon and the word.
- The comment field opens automatically on Fail; "Comment required" shown until filled.
- Works one-handed: sticky **Next section** at the bottom; no hover-only controls.
- Saved state per item: "Saved on this device" offline, nothing online (the indicator shows pending counts).
- Arabic right-to-left; numbers and the score in `<bdi dir="ltr">`.

## Error Handling

| Case               | Response                       |
| ------------------ | ------------------------------ |
| Unknown item key   | `422 INSPECTION_ITEM_UNKNOWN`  |
| Result not allowed | `422 VALIDATION_FAILED`        |
| Not In Progress    | `409 INSPECTION_LOCKED`        |
| Not the inspector  | `403 INSPECTION_NOT_INSPECTOR` |
| Stale offline item | `409 SYNC_CONFLICT`            |
| Read-only company  | `403 SUBSCRIPTION_READ_ONLY`   |

## Notifications

None.

## Audit Requirements

`inspection.items_saved` (item keys with old and new result), `inspection.updated` (header, old and new); offline metadata (O-130).

## Acceptance Criteria

- An inspector answers 32 items offline, closes and reopens the app offline, and every answer is still there; back online all are on the server with one row per item.
- The same item changed on two devices offline shows one conflict for that item; other items sync normally.
- A result the template doesn't allow is refused.
- The live score on the phone equals the score stored on submit.

## Test Scenarios

- **Positive:** upsert, change, clear; header update; grouping of entries; offline replay (one row); per-item conflict; Keep mine / Keep theirs on an item.
- **Negative:** unknown key; disallowed result; priority without Fail/Observation; not the inspector; Submitted inspection; read-only company; item of another inspection's version.

## Future Improvements

Voice notes; item-level timestamps on the report; conditional items; bulk "all Pass" for a section with confirmation.
