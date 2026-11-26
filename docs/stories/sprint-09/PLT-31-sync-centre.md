# PLT-31 — Sync Centre, Connection Indicator and Sign-Out Handling

| Field    | Value                                                                                     |
| -------- | ----------------------------------------------------------------------------------------- |
| Epic     | Platform — Offline foundation (Doc 01 §15)                                                |
| Priority | Must                                                                                      |
| Status   | Approved                                                                                  |
| Sources  | Master Rules Rule 15, "never rely only on colour"; D-20; T-71; O-119, O-120, O-123, O-126 |

## Business Goal

People on site must always know whether their work has reached the office. A clear indicator and one place to see, retry or fix queued items prevent both lost work and duplicate re-entry.

## User Story

As a **site user**, I want to see at a glance whether everything is synced, and one page to deal with what isn't, so that I trust the app with my reports.

## Description

### Connection indicator (header)

| State                   | Shown as                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Online, nothing pending | Nothing (no noise when all is well)                                                   |
| Offline                 | Cloud-off icon + "Offline" (+ "· n pending")                                          |
| Syncing                 | Spinner icon + "Syncing n"                                                            |
| Needs attention         | Warning icon + "n need attention" (Needs attention + conflicts + waiting for sign-in) |

Selecting it opens the sync centre. Text is always present; colour only supports it.

### Sync centre (`<slug>/sync`)

Tabs: **Pending** (pending, sending, waiting read-only, waiting sign-in), **Needs attention**, **Conflicts** (PLT-30), **Synced** (last 24 h). Each item: record label, project code, kind (new, change, photo), captured time, state and reason. Actions:

- **Sync now** (online only) — runs the engine immediately.
- On a Needs attention item: **Open** (when the module supports editing queued items), **Copy text**, **Discard** (confirmation listing what is lost, including dependent photos).
- **Refresh offline data** and the list of projects kept on this device (PLT-26), with storage used and the browser's quota (warning at 80 %, O-120).

### Sign-out (O-119)

When the user signs out with unsynced items (any state except synced), a dialog says "**n items are not synced yet**" with:

1. **Sync now** (online only; signs out after success);
2. **Sign out and keep them on this device** (default);
3. **Discard and sign out** — a second step lists the items and asks to confirm.

A server-ended session (revoked, suspended) never discards.

## Actors

Every signed-in user (own items only).

## Preconditions

- The device store is available (PLT-26).

## User Flow

1. The header shows "Offline · 3 pending"; the user taps it: Pending lists three items.
2. Online, one item moves to Needs attention: "You no longer have access to project RMX-02". The user copies the note text and discards the item.
3. Signing out with one pending item shows the dialog; they keep it; next sign-in it syncs.

## Functional Requirements

The system shall:

1. Show the indicator on every app page and update it within a second of a state change.
2. List only the current user's items in the sync centre, grouped by tab, newest first, with reasons translated from the error code.
3. Provide Sync now, Discard (with confirmation, cascading to dependent items), Copy text and Refresh offline data.
4. Show storage use and warnings (O-120); show "This browser can't store data for offline use" when IndexedDB is unavailable.
5. Intercept user-initiated sign-out when unsynced items exist and offer the three choices.
6. On "Discard and sign out", delete the user's outbox items, blobs, drafts and device conflicts (server conflicts stay open and are listed again at the next sign-in on any device).
7. Work offline (the page is offline-capable, PLT-25).

## Validation Rules

None.

## Permission Rules

Own items only; no server data beyond PLT-30's conflict list.

## Database Impact

None on the server.

## API Requirements

None of its own (uses PLT-27 and PLT-30).

## UI Requirements

- Cards at every width; dialogs full-screen on phone.
- Logical `start`/`end` classes; Arabic right-to-left; times and codes in `<bdi dir="ltr">`.
- Never colour alone: every state has an icon and a word.

## Error Handling

| Case                          | Behaviour                             |
| ----------------------------- | ------------------------------------- |
| Sync now while offline        | Button disabled with "You're offline" |
| Discard fails (storage error) | Message, item kept                    |

## Notifications

None (PLT-30 notifies conflicts).

## Audit Requirements

None on the server for device actions. A discard of an item the server never received leaves no trace on the server by design; the confirmation says so.

## Acceptance Criteria

- Offline with three queued items, the header reads "Offline · 3 pending" in English and its Arabic text in Arabic, with an icon.
- A Needs attention item shows its reason in the user's language; Discard removes it and its photos after confirmation.
- Signing out with pending items shows the dialog; Keep leaves them on the device; Discard removes them after the second confirmation.
- The sync centre opens offline.

## Test Scenarios

- **Positive:** each tab; Sync now; Refresh offline data; sign-out keep.
- **Negative:** sign-out discard cancelled at the second step; forced sign-out keeps items; another user's items never listed.

## Future Improvements

Per-item retry history; export of unsynced items as a file for support.
