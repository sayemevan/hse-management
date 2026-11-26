# PLT-29 — Idempotent API Writes and Client-Generated Ids

| Field    | Value                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| Epic     | Platform — Offline foundation (Doc 01 §15)                                               |
| Priority | Must                                                                                     |
| Status   | Approved                                                                                 |
| Sources  | D-11; review "Consequences": idempotent API writes; T-24, T-60, T-68, T-69; O-124, O-130 |

## Business Goal

On a weak connection a request can reach the server while its answer is lost. The device sends it again; the server must apply it **once**, so no inspection, hazard report or photo is ever duplicated.

## User Story

As a **site user**, I want a change sent twice to count once, so that a bad connection never creates duplicate records.

## Description

### Idempotency-Key (T-69)

- Offline-capable write routes are wrapped with **`idempotent()`**. The header `Idempotency-Key` (UUID) is **optional for online use and always sent by the sync engine**.
- The helper computes `request_hash` = SHA-256 of method, route and the canonical body (for multipart: field values and each file's SHA-256).
- **First time:** the handler runs; the service adds `idempotency.record({ … resourceType, resourceId, statusCode })` to its `UnitOfWork`, so the key row is committed in the same batch as the change.
- **Seen before, same hash:** the handler is not run; the helper reads the resource through the module's registered reader and returns the original status with the current resource and `Idempotent-Replayed: true`.
- **Seen before, other hash:** `422 IDEMPOTENCY_KEY_REUSED`.
- **Race:** two copies at once → the second batch fails on the unique index (`company_id`, `key`); the helper catches that and replays.
- Keys belong to the company and the user: another user sending the same key gets `422 IDEMPOTENCY_KEY_REUSED`, never someone else's result.
- Only successful changes store a key; a refused request (4xx) can be retried with the same key after fixing it.
- Keys expire after **30 days** (O-124); the daily housekeeping job deletes expired rows.

### Client-generated ids (T-68)

- Offline-capable create routes accept an optional `id` (UUID v4). If missing, the server generates one as today.
- If the id exists **in the same company and was created by the same user through the same route**, the request is treated as a replay (a lost answer without an idempotency key); otherwise `409 RECORD_ID_TAKEN`.
- Ids from another company never collide in practice (UUIDs), and the lookup is scoped by company, so no record of another company is ever revealed.

### Read-only mode (T-24)

Read-only refusal runs before the idempotency check, as today; a replay of a change accepted before the company became read-only still returns the stored result (it is a read).

## Actors

The sync engine (PLT-28); any API client.

## Preconditions

- The route is marked `idempotent()`.

## User Flow

No screen. The device's retry after a lost answer receives the original result and marks the item synced.

## Functional Requirements

The system shall:

1. Provide `idempotent({ resourceType, read })` for routes and `IdempotencyService.record(...)` returning a statement for the caller's `UnitOfWork`.
2. Validate the header: a UUID, otherwise `400 IDEMPOTENCY_KEY_INVALID`.
3. Replay, refuse or run as described; never run the handler twice for one key.
4. Write the audit entry only on the first run; a replay writes none (O-130).
5. Accept client ids on offline-capable creates as described.
6. Delete expired keys daily.
7. Apply `idempotent()` in Sprint 9 to the sync probe routes and to the shared file-upload path used by offline modules; Sprint 10 applies it to inspection writes.

## Validation Rules

| Field             | Rule              |
| ----------------- | ----------------- |
| `Idempotency-Key` | UUID, optional    |
| `id` on create    | UUID v4, optional |

## Permission Rules

None of its own; the route's permission is checked on every request, including replays (a user who lost access gets `403`, not the old result).

## Database Impact

New table **`idempotency_key`**:

| Column                         | Type      | Rule                                 |
| ------------------------------ | --------- | ------------------------------------ |
| `id`                           | text PK   | UUID                                 |
| `company_id`                   | text      | FK company; with `key` unique        |
| `user_id`                      | text      | FK user                              |
| `key`                          | text      | the header value                     |
| `method`, `route`              | text      | route pattern, not the concrete path |
| `request_hash`                 | text      | SHA-256 hex                          |
| `status_code`                  | integer   | 200 or 201                           |
| `resource_type`, `resource_id` | text      | what to read on replay               |
| `created_at`, `expires_at`     | timestamp | expiry index for housekeeping        |

## API Requirements

- Request header `Idempotency-Key`; response header `Idempotent-Replayed: true` on replays.
- Error codes `IDEMPOTENCY_KEY_INVALID` (400), `IDEMPOTENCY_KEY_REUSED` (422), `RECORD_ID_TAKEN` (409).

## UI Requirements

None.

## Error Handling

| Case                              | Response                      |
| --------------------------------- | ----------------------------- |
| Header not a UUID                 | `400 IDEMPOTENCY_KEY_INVALID` |
| Same key, different body or user  | `422 IDEMPOTENCY_KEY_REUSED`  |
| Client id used by another record  | `409 RECORD_ID_TAKEN`         |
| Permission lost before the replay | `403 FORBIDDEN`               |

## Notifications

None; notifications of the original change are not sent again on replay.

## Audit Requirements

None of its own; the first run's audit entry carries the key (O-130).

## Acceptance Criteria

- A probe create sent twice with one key → one row, one audit entry, two `201` answers, the second with `Idempotent-Replayed: true`.
- Ten parallel copies → one row; all ten answers carry the same id.
- The same key with a changed title → `422 IDEMPOTENCY_KEY_REUSED`.
- A create with a client id already used by another user → `409 RECORD_ID_TAKEN`.
- Keys older than 30 days are gone after the job runs.

## Test Scenarios

- **Positive:** replay, race, client id kept, multipart replay with the same file.
- **Negative:** invalid header; another company's key value; another user's key value; a refused request leaves no key; permission removed before replay.

## Future Improvements

Apply `idempotent()` to every write route (useful for online double-clicks too).
