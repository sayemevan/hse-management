# PLT-28 — Sync Queue and Sync Engine (Changes and Photos)

| Field    | Value                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform — Offline foundation (Doc 01 §15)                                                                                              |
| Priority | Must                                                                                                                                    |
| Status   | Approved                                                                                                                                |
| Sources  | Product Book Doc 01 §15 "synchronize automatically"; D-11, D-18, D-28; T-68, T-71, T-72, T-74; O-116, O-117, O-121, O-123, O-126, O-129 |

## Business Goal

What was captured offline reaches the server by itself, once, in the right order, with its photos — and nothing is lost when the server refuses something.

## User Story

As a **site user**, I want my offline work to be sent automatically when I'm back online, so that I don't have to remember to upload it or enter it twice.

## Description

### Outbox item

Each queued change is one row in the `outbox` store:

| Field                                    | Rule                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `seq`                                    | Auto-increment; defines order                                                                         |
| `userId`                                 | Owner of the item (PLT-27)                                                                            |
| `entityType`, `entityId`                 | Registered type (T-72) and the record id, made on the device for creates (T-68)                       |
| `kind`                                   | `create`, `update`, `upload`, `custom`                                                                |
| `request`                                | Method, path, body (API contract format), `contractVersion` (O-125), `baseVersion` for updates        |
| `idempotencyKey`                         | UUID, fixed when the item is created, sent on every attempt (T-69)                                    |
| `blobId`                                 | For uploads: the compressed photo in `blobs` (T-74)                                                   |
| `dependsOn`                              | `seq` of the item that must succeed first (a photo depends on its record's create)                    |
| `state`                                  | `pending`, `sending`, `waiting_sign_in`, `waiting_read_only`, `needs_attention`, `conflict`, `synced` |
| `attempts`, `nextAttemptAt`, `lastError` | Retry state and the last reason (error code and translated message key)                               |
| `capturedAt`, `deviceOffset`             | Device time of capture (O-129)                                                                        |
| `syncedAt`                               | When the server accepted it; synced items are removed after 24 h (O-120)                              |

### Engine (T-71)

- **Triggers:** `online` event, app start and focus, 60-second interval while items are pending, a new item, Background Sync (`sync` event, Chromium only, O-117).
- **One runner:** a Web Lock `hse-sync` so two tabs never send at once; the service worker uses the same lock for Background Sync.
- **Order:** an item is sent only when its `dependsOn` item is `synced`; items of one `entityId` go one at a time in `seq` order; up to 3 different records in parallel.
- **Back-off:** 5 s, 15 s, 1 min, 5 min, then every 15 min; reset when the connection comes back.

### Response handling

| Response                                                                     | New state                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `2xx` (including a replay, `Idempotent-Replayed: true`)                      | `synced`; `fromServer` updates the device copy (new number, version)                                                                 |
| Network error, `5xx`, `429`                                                  | `pending`, retry with back-off                                                                                                       |
| `401` / session ended                                                        | `waiting_sign_in` (PLT-27)                                                                                                           |
| `403 SUBSCRIPTION_READ_ONLY`                                                 | `waiting_read_only`, retried every 15 min and when the tenant state says active (O-126)                                              |
| `409 SYNC_CONFLICT`                                                          | `conflict` (PLT-30); dependent items wait                                                                                            |
| Other `4xx` (validation, permission, not found, archived, `RECORD_ID_TAKEN`) | `needs_attention` with the reason (O-123); dependent items also go to `needs_attention` ("Waiting for an item that needs attention") |

### Photos (T-74)

`compressPhoto(file)` re-encodes to JPEG, long edge ≤ 2,560 px, quality 0.82, no EXIF; refuses non-images and files the browser can't decode. The blob is stored, an `upload` item is queued that depends on the record's create, and uploads use the owning module's file route as multipart with the `Idempotency-Key`.

### Sync probe (O-116, development and test only)

`dev.sync_probe` (title 1–100, note up to 2,000, up to 20 photos, `version`) with `POST /dev/sync-probes`, `PATCH /dev/sync-probes/{id}`, `POST /dev/sync-probes/{id}/photos`, `GET /dev/sync-probes/{id}`. Routes and table exist only when `ENVIRONMENT` is `development` or `test`; the web screen `/dev/sync-probe` exists only in the development build.

## Actors

Every signed-in user with queued items.

## Preconditions

- Items queued by a registered offline entity (T-72).

## User Flow

1. Offline, the user saves a probe with two photos: three items (create, two uploads) appear in the sync centre as Pending; the indicator shows **Offline · 3 pending**.
2. The connection returns: the indicator shows **Syncing 3**; the create goes first, then both uploads; the indicator returns to **Online**.
3. One upload is refused (for example the plan's storage is full): it moves to **Needs attention** with "Your company has reached its storage limit"; the record itself is synced.

## Functional Requirements

The system shall:

1. Queue items only through the offline-entity contract (T-72); every item gets its idempotency key at creation.
2. Send items in the order and with the limits above; never send an item whose dependency isn't synced.
3. Retry and route responses exactly as in the table; never delete an item that the server did not accept, except by the user's explicit discard (PLT-31).
4. Send `X-Captured-At` (ISO time with offset) and `X-Device-Id` on synced requests; the API stores them where the module records `capturedAt` and in the audit metadata (O-129, O-130).
5. Compress photos as T-74 before storing; refuse new photos above 20 per record (O-121) or at 95 % of quota (O-120).
6. Update the device copy from the server's answer (`fromServer`), including the record number and new version.
7. Remove synced items and their blobs 24 hours after `syncedAt`.
8. Expose state changes to the UI (indicator, sync centre) through one subscription.

## Validation Rules

Bodies are validated with the module's shared Zod schema before queuing; the server validates again on sync.

## Permission Rules

None of its own: the target route's permission applies on sync. The probe routes need only a signed-in user and exist only in development and test.

## Database Impact

`dev_sync_probe` and `dev_sync_probe_file` (development and test only; created by a migration that is skipped outside those environments, or by the test setup — decided in the build).

## API Requirements

- Headers on synced writes: `Idempotency-Key` (PLT-29), `X-Captured-At`, `X-Device-Id`.
- Probe routes as above (development and test only).

## UI Requirements

- State changes reach the indicator within a second; Arabic and English texts for every state and every reason.

## Error Handling

As the response table; IndexedDB write failures show "Could not save on this device" and keep the form open.

## Notifications

None (the sync centre and indicator show state; conflicts are in PLT-30).

## Audit Requirements

Synced writes are audited by the target module with `offline`, `capturedAt`, `deviceId` and the idempotency key (O-130).

## Acceptance Criteria

- A probe created offline with two photos syncs as one record with two photos; repeating the sync (simulated lost answer) creates nothing new.
- Photos are stored on the server at ≤ 2,560 px with no EXIF.
- A refused photo goes to Needs attention while the record stays synced.
- With two tabs open, each item is sent once.
- The production build has no probe route, table or screen.

## Test Scenarios

- **Positive:** ordering, dependencies, parallel limit, back-off schedule, replay treated as success.
- **Negative:** each response class; dependency in Needs attention; read-only company; session ended mid-sync; quota full; non-image file.

## Future Improvements

Resumable chunked uploads for large files; sync progress per byte; sync on a schedule in the background (Periodic Background Sync).
