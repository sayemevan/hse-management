# US-004 — Logout

| Field    | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security                                        |
| Priority | Must                                                                       |
| Status   | Approved                                                                   |
| Sources  | Product Book Doc 14, Doc 16; Master Rules MASTER_RULES_02 (audit "Logout") |

## Business Goal

Let users end their session on a device, especially shared site tablets, so no one else can act in their name.

## Description

Signing out ends the current session on the server, clears the refresh cookie and the in-memory access token, and returns the user to the login page. Ending sessions on _other_ devices is US-010.

## Actors

Every signed-in user.

## Preconditions

The user is signed in.

## User Flow

1. Open the user menu.
2. Select **Sign out**.
3. The session is revoked and the user sees the login page.
4. The logout is recorded in the audit log.

## Functional Requirements

The system shall:

1. Mark the current session revoked (`revoked_reason = logout`).
2. Clear the refresh cookie and discard the access token in the browser.
3. Make any copy of the access token fail immediately, because every request checks the session (T-2).
4. Succeed even if the session has already expired (sign-out is idempotent).
5. Clear locally cached personal data from the browser on sign-out. Offline drafts that haven't synced are **kept** and the user is warned first (D-11, Sprint 9 onwards).

## Validation Rules

None (no input).

## Permission Rules

Any authenticated user may end their own current session.

## Database Impact

Updates `user_session.revoked_at` and `revoked_reason`. Writes `audit_log`.

## API Requirements

`POST /api/v1/auth/logout` — no body; uses the session from the access token and refresh cookie. Output: success envelope with no data.

## UI Requirements

- **Sign out** in the user menu (desktop sidebar and mobile Profile tab, Doc 05 §4), with an icon and a label (Doc 05 §14).
- No confirmation dialog (Doc 05 §24: avoid unnecessary confirmations), except when unsynced offline drafts exist (from Sprint 9).

## Error Handling

If the server can't be reached, the browser still clears its tokens and shows the login page; the server-side session then expires by the idle rule.

## Notifications

None.

## Audit Requirements

`auth.logout` with user, session, time, device and IP.

## Acceptance Criteria

- After signing out, the user sees the login page and protected pages redirect to it.
- The old access token and refresh cookie no longer work.
- Signing out twice does not produce an error.
- An audit record is written.

## Test Scenarios

- **Positive:** sign out from desktop and from mobile.
- **Negative:** reuse the old access token after sign-out (401); reuse the old refresh cookie (401).
- **Edge:** sign out while offline; sign out with an already-expired session.

## Future Improvements

Automatic sign-out on shared devices after a shorter idle time (device-type policy).
