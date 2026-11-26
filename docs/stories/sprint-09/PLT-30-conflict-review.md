# PLT-30 — Conflict Detection and Conflict Review

| Field    | Value                                                      |
| -------- | ---------------------------------------------------------- |
| Epic     | Platform — Offline foundation (Doc 01 §15)                 |
| Priority | Must                                                       |
| Status   | Approved                                                   |
| Sources  | D-20 (F-05); T-70, T-72; O-122, O-124, O-126, O-130, O-131 |

## Business Goal

Two people may change the same record — one offline, one online. D-20: **conflicts are flagged for review, both versions are kept, the user chooses, and nothing is silently overwritten.**

## User Story

As a **site user** whose offline change clashed with someone else's, I want to see both versions and choose what stays, so that neither my work nor theirs is lost without anyone deciding.

## Description

### Detection (T-70)

- Offline-capable records carry `version` (integer, starts at 1, +1 on every change by any route, online or offline).
- Offline **updates** carry `baseVersion`. The repository applies the update **only `WHERE version = baseVersion`**, with a guard statement in the same batch (the Sprint 8 pattern) so nothing else in the batch runs when it doesn't apply.
- On mismatch the API writes a **`sync_conflict`** row (both versions: the server's current record by reference and version, the client's payload in full) and answers `409 SYNC_CONFLICT` with `{ conflictId, serverRecord, serverVersion }`.
- **Creates, photo uploads and new notes never conflict**; they are additions.
- Online edits of the same records also send `baseVersion` from Sprint 10 onwards; online, a mismatch shows "Someone changed this while you were editing" with Reload (no conflict row).

### Resolution (O-122)

The conflict appears on the device (`conflicts` store) and in the sync centre. The review screen shows, for each field the module lists in `conflictFields` (T-72), **Mine** and **Theirs** side by side with changed fields marked. Choices:

| Choice          | Effect                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| **Keep mine**   | The device sends its values again with `baseVersion` = the server's version and the `conflictId`            |
| **Keep theirs** | Nothing is sent to the record; the conflict is marked `discarded` on the server; the device copy is dropped |
| **Combine**     | Per field, Mine or Theirs; sent like Keep mine with the combined values                                     |

Resolution goes through `POST /me/sync/conflicts/{id}/resolve` with `{ choice, values? }`. For Keep mine and Combine the server calls the module's registered resolver, which applies the change through the module's normal service (permissions, validation, audit). If the record changed **again** meanwhile, the resolve answers a new `409 SYNC_CONFLICT` and the screen refreshes Theirs.

Items that depend on a conflicted item (for example its photos) wait and continue after resolution.

## Actors

The user who made the offline change (only them).

## Preconditions

- A `409 SYNC_CONFLICT` was received for one of the user's items.

## User Flow

1. The indicator shows **Needs attention 1**; the sync centre's **Conflicts** tab lists "Sync probe _Pump check_ — changed by Demo Safety Officer at 10:42".
2. The user opens it: two columns (stacked on phone, Mine first), changed fields marked "Changed".
3. They choose **Combine**, pick Theirs for the title and Mine for the note, and confirm.
4. The record is updated; the conflict leaves the list; the record's history shows "Conflict resolved — combined".

## Functional Requirements

The system shall:

1. Detect conflicts by version as described, without applying any part of the update.
2. Store each conflict in `sync_conflict` with the client payload, base and server versions, permanently (O-124).
3. Return the server record with the conflict so the device can show it offline later.
4. Let only the conflict's user list and resolve it; others get `404`.
5. Resolve through the module's resolver, re-checking permissions and validation; a refused resolution keeps the conflict open with the reason.
6. Refuse a second resolution: `409 SYNC_CONFLICT_RESOLVED`.
7. Block resolution in read-only mode (T-24); the conflict stays open (O-126).
8. Keep the device conflict until the server confirms the resolution.

## Validation Rules

| Field    | Rule                                                                 |
| -------- | -------------------------------------------------------------------- |
| `choice` | `mine`, `theirs`, `combine`                                          |
| `values` | Required for `combine`; only fields in the module's `conflictFields` |

## Permission Rules

Own conflicts only. Applying the values needs the module's normal write permission. No new permissions (O-127).

## Database Impact

New table **`sync_conflict`**:

| Column                           | Type      | Rule                                  |
| -------------------------------- | --------- | ------------------------------------- |
| `id`                             | text PK   | UUID                                  |
| `company_id`                     | text      | FK company                            |
| `project_id`                     | text      | nullable, FK project                  |
| `user_id`                        | text      | FK user; index with `status`          |
| `entity_type`, `entity_id`       | text      | the record                            |
| `base_version`, `server_version` | integer   |                                       |
| `client_payload`                 | text JSON | the device's values, as sent          |
| `server_snapshot`                | text JSON | the server's values at detection      |
| `status`                         | text      | `open`, `resolved`, `discarded`       |
| `resolution`                     | text      | `mine`, `theirs`, `combine`; nullable |
| `resolved_values`                | text JSON | nullable                              |
| `created_at`, `resolved_at`      | timestamp |                                       |

Rows are never deleted; after resolution they are read-only (trigger against UPDATE of resolved rows).

`version` columns on business tables are added by each module from Sprint 10; Sprint 9 adds it to `dev_sync_probe`.

## API Requirements

- `GET /api/v1/me/sync/conflicts?status=open` → `{ items: [{ id, entityType, entityId, label, projectCode, createdAt, serverVersion }] }`.
- `GET /api/v1/me/sync/conflicts/{conflictId}` → the conflict with `clientPayload` and `serverSnapshot`.
- `POST /api/v1/me/sync/conflicts/{conflictId}/resolve` → `{ status, record }`.

## UI Requirements

- Screen `<slug>/sync/conflicts/{id}`: header with the record label and who changed it when; two columns on desktop, stacked on phone; changed fields marked with an icon and the word "Changed" (never colour alone); a sticky footer with the three choices.
- Keep theirs asks for confirmation: "Your changes to this record will be dropped from this device. A copy stays in the record's history."
- Arabic right-to-left; values that are codes or dates in `<bdi dir="ltr">`.

## Error Handling

| Case                          | Response                      |
| ----------------------------- | ----------------------------- |
| Not the conflict's user       | `404 NOT_FOUND`               |
| Already resolved              | `409 SYNC_CONFLICT_RESOLVED`  |
| Record changed again          | `409 SYNC_CONFLICT` (new row) |
| Company read-only             | `403 SUBSCRIPTION_READ_ONLY`  |
| Validation of combined values | `422 VALIDATION_FAILED`       |

## Notifications

An in-app notification **`sync.conflict`** to the user when a conflict is detected ("Your offline change to … needs review"), so they see it on any device; the daily job reminds once after **2 days** if it's still open (one `ReminderService` key per conflict).

## Audit Requirements

`sync.conflict_detected` (entity, versions) and `sync.conflict_resolved` (choice); the module's own audit entry for the applied change (O-130).

## Acceptance Criteria

- An offline update with base version 1 against server version 2 changes nothing, returns `SYNC_CONFLICT` and creates one `sync_conflict` row with both versions.
- Keep mine → the record holds the device values at version 3; Keep theirs → the record is unchanged and the conflict is `discarded`; Combine → the chosen mix at version 3.
- Another user can't see or resolve the conflict.
- Resolution is refused in read-only mode and works after the company is active again.
- The user is notified once on detection and once after 2 days.

## Test Scenarios

- **Positive:** the three choices; dependent photos continue after resolution; resolution offline is queued and sent later.
- **Negative:** second resolve; record changed again; values for a field not in `conflictFields`; another company's conflict id.

## Future Improvements

Automatic merge of non-overlapping field changes after the PO approves a rule; a company view of open conflicts (Sprint 19).
