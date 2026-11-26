# PLT-26 — Device Store and Reference Data

| Field    | Value                                                               |
| -------- | ------------------------------------------------------------------- |
| Epic     | Platform — Offline foundation (Doc 01 §15)                          |
| Priority | Must                                                                |
| Status   | Approved                                                            |
| Sources  | Product Book Doc 01 §15; D-06, D-11; T-67, T-72, T-73; O-118, O-120 |

## Business Goal

A capture form on site needs the project, its areas, locations and work zones, and the people who can be named — without a connection. They must be on the device before the signal drops, and kept only for the person who may see them.

## User Story

As a **site user**, I want the projects and places I work with to be on my phone, so that I can fill in a form offline and choose them from a list.

## Description

The **device store** (T-67) is one IndexedDB database per company subdomain, opened through `idb`, with a versioned schema:

| Object store | Key                          | Holds                                                                    |
| ------------ | ---------------------------- | ------------------------------------------------------------------------ |
| `meta`       | name                         | schema version, `deviceId` (random, per installation), last full refresh |
| `session`    | `userId`                     | offline profile (PLT-27)                                                 |
| `reference`  | `[userId, packKey, scopeId]` | reference packs with `fetchedAt` and the server's `etag`                 |
| `drafts`     | `[userId, entityType, id]`   | forms started but not submitted (used by modules from Sprint 10)         |
| `outbox`     | auto-increment `seq`         | queued changes (PLT-28)                                                  |
| `blobs`      | id                           | compressed photos linked to outbox items (T-74)                          |
| `conflicts`  | `[userId, conflictId]`       | conflicts waiting for review (PLT-30)                                    |

Every row has `userId`; every read is filtered by the signed-in (or offline-profile) user.

### Reference packs (T-72)

A pack is registered with `registerReferencePack({ key, scope: 'user' | 'project', load, maxAgeHours })`. Sprint 9 registers:

| Pack           | Scope   | Content                                                                           |
| -------------- | ------- | --------------------------------------------------------------------------------- |
| `profile`      | user    | the offline profile (PLT-27)                                                      |
| `projects`     | user    | projects the user can view and that accept records (id, code, name, status)       |
| `project-pack` | project | active areas, locations, work zones; members who are users (id, name) for pickers |

Sprint 10 adds inspection templates; Sprint 11 hazard categories.

**Which projects are kept:** the user's **pinned** projects for offline (a "Keep on this device" switch on the project page) plus the last **3 projects opened**, at most **10**. Packs refresh when the app is online and a pack is older than its `maxAgeHours` (default 12 h), when the user opens the project, and from **Refresh offline data** in the sync centre.

## Actors

Every signed-in user on a company subdomain.

## Preconditions

- Signed in online at least once on the device (PLT-27).

## User Flow

1. The user signs in; the app saves the profile and the `projects` pack.
2. They open RMX-02; its pack is fetched in the background (`GET /projects/{id}/offline-pack`).
3. On the project page they turn on **Keep on this device**; the sync centre lists RMX-02 under "Available offline" with the time of the last refresh.
4. Offline, a capture form's pickers read from the pack; a "Data from 2 h ago" note appears when the pack is older than 12 h.

## Functional Requirements

The system shall:

1. Create and migrate the device store with a versioned upgrade; a failed upgrade deletes and recreates it only when the outbox, blobs and conflicts are empty, otherwise keeps the old version and shows "Update needs attention" in the sync centre.
2. Expose typed read and write helpers per store; modules never open IndexedDB directly.
3. Filter every read by the current user; never return another user's rows.
4. Fetch, store and refresh reference packs as described, using `If-None-Match` and the pack's `etag`.
5. Remove a project's pack when the user loses access (the `projects` pack no longer lists it) unless queued items for that project remain.
6. Provide `GET /projects/{projectId}/offline-pack` returning places and member users in one response with an `ETag`.
7. Report storage use (`navigator.storage.estimate()`) and request persistent storage at the first offline capture (O-120).

## Validation Rules

Pack responses are parsed with the shared Zod schemas; an invalid pack is discarded and the previous one kept.

## Permission Rules

The offline pack needs `projects.view` on the project (the same data the project's place and member pickers show online). No new permissions (O-127).

## Database Impact

None on the server. Device schema as above.

## API Requirements

- `GET /api/v1/projects/{projectId}/offline-pack` → `{ project, areas, locations, workZones, members, generatedAt }` with `ETag`; `304` when unchanged.

## UI Requirements

- Project page: **Keep on this device** switch with a short help text; disabled while offline.
- Pickers show "Data from {time}" when stale; dates and codes in `<bdi dir="ltr">`.

## Error Handling

| Case                                 | Response / behaviour                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Project not visible                  | `404 NOT_FOUND`; pack removed on device                                                         |
| IndexedDB unavailable (private mode) | Offline features off; notice in the sync centre "This browser can't store data for offline use" |
| Quota near full                      | Warning at 80 %, new photos refused at 95 % (O-120)                                             |

## Notifications

None.

## Audit Requirements

None (reads).

## Acceptance Criteria

- After sign-in and opening RMX-02, the device store holds the profile, the projects pack and RMX-02's pack; another user signing in on the same device sees none of them.
- Turning on Keep on this device for an 11th project removes the least recently opened unpinned one, or refuses with "Up to 10 projects" when all are pinned.
- A user removed from a project loses its pack at the next refresh.
- A second `offline-pack` request with the `ETag` returns `304`.

## Test Scenarios

- **Positive:** upgrade from schema 1 to 2 with data kept; pack refresh by age and on demand.
- **Negative:** another company's project id; invalid pack JSON; private browsing without IndexedDB; two users' rows on one device.

## Future Improvements

Encrypting the store with a key derived on sign-in; delta updates for large packs.
