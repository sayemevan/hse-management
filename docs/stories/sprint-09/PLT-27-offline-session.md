# PLT-27 — Offline Session

| Field    | Value                                           |
| -------- | ----------------------------------------------- |
| Epic     | Platform — Offline foundation (Doc 01 §15)      |
| Priority | Must                                            |
| Status   | Approved                                        |
| Sources  | D-04, D-08, D-11; T-1, T-32, T-73; O-118, O-126 |

## Business Goal

Someone who was signed in when the signal dropped keeps working, and their work is sent as them, without weakening the session security of Sprint 1 (tokens never on disk).

## User Story

As a **site user**, I want the app to remember who I am when I'm offline, so that I can keep capturing; and when I'm back online, I want my work sent under my own account.

## Description

Today the app starts by refreshing the access token through the `HttpOnly` cookie (T-1); without a network that fails and the app shows the sign-in page. With this enabler:

- On every successful online start, the app stores the **offline profile** (T-73) in the device store: `userId`, name, company slug and name, language, time zone, read-only state of the company, and a **permission snapshot** (company permissions and, per project in the `projects` pack, the project permissions), plus `savedAt`.
- If the refresh fails **because of the network** (not because the server said the session ended), the app opens in **offline mode** on that profile.
- Offline mode lets the user use offline-capable screens the snapshot allows and queue changes. It never invents a token.
- When the network returns, the app refreshes the token. If that works, sync starts. If the server says the session is over, the app shows **"Sign in to finish syncing"**; after the **same user** signs in, sync continues. If another user signs in, the first user's items stay locked on the device (O-118).

## Actors

Every user on a company subdomain.

## Preconditions

- An offline profile saved within the last **7 days** (O-118).

## User Flow

1. Online: the user signs in; the profile is saved.
2. The phone loses signal; the user reopens the app: header **Offline**, the home page shows the offline-capable screens and the sync centre.
3. 8 days later, still offline: capture screens show **"Connect to the internet to continue"**; the sync centre still lists queued items.
4. Back online after the 8-hour idle limit: the refresh is refused; a banner says **"Sign in to finish syncing — 3 items waiting"**; sign-in opens with the email filled in; after sign-in the items sync.

## Functional Requirements

The system shall:

1. Save and update the offline profile after every successful `/auth/me` or token refresh, and after language or permission changes seen online.
2. Provide `GET /me/offline-profile` returning the profile fields and the permission snapshot for the user's projects in one call.
3. Distinguish a network failure (`status 0`, `SERVICE_UNAVAILABLE` from the API client) from a session that ended (`SESSION_EXPIRED`, `UNAUTHENTICATED`, `ACCOUNT_INACTIVE`); only the first enters offline mode.
4. Enter offline mode only with a profile younger than 7 days; otherwise show the sign-in page with "Connect to the internet to sign in".
5. Never store the access token, the refresh token or the password on the device.
6. Pause the sync engine while there is no live session; resume after a successful refresh or sign-in by the same `userId`.
7. Lock queued items to their `userId`: another user on the device can't see, send or discard them; the sign-in page shows "Items from another account are waiting on this device" without names.
8. Treat the snapshot as a hint only: the server re-checks every permission when items sync (T-32).

## Validation Rules

The stored profile is parsed with the shared schema on read; an invalid profile is treated as missing.

## Permission Rules

`GET /me/offline-profile`: signed in, own data only.

## Database Impact

None on the server.

## API Requirements

- `GET /api/v1/me/offline-profile` → `{ user, company: { slug, name, timeZone, readOnly }, language, companyPermissions, projects: [{ id, code, permissions }], generatedAt }`.

## UI Requirements

- Header indicator **Offline** (PLT-31); a banner "Sign in to finish syncing — n items waiting" when needed.
- Sign-in page notice when another account's items are on the device.
- Arabic right-to-left.

## Error Handling

| Case                                      | Behaviour                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Network down, profile < 7 days            | Offline mode                                                                                          |
| Network down, profile ≥ 7 days or missing | Sign-in page with "Connect to the internet to sign in"                                                |
| Session ended (server answered)           | Sign-in page; queued items kept                                                                       |
| Account suspended                         | Sign-in refused as today; items kept, shown in the sync centre after an admin reactivates the account |

## Notifications

None.

## Audit Requirements

None beyond the existing sign-in audit.

## Acceptance Criteria

- With the network off, a user who signed in an hour ago opens the app in offline mode with their name and language.
- No token or password is found in IndexedDB, `localStorage` or cache storage.
- After the session expires offline, the user signs in again and the waiting items sync under their account; signing in as another user leaves them untouched.
- A permission removed while the device was offline is enforced when the items sync (item moves to Needs attention, PLT-28).

## Test Scenarios

- **Positive:** offline start; resume after refresh; resume after sign-in of the same user.
- **Negative:** profile older than 7 days; another user signs in; server-ended session not mistaken for offline.

## Future Improvements

Offline unlock with a device PIN or passkey; shorter offline window per company setting.
