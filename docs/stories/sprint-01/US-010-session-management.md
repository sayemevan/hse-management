# US-010 — Session Management

| Field    | Value                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------ |
| Epic     | Epic 01 — Authentication & Security                                                                    |
| Priority | Must                                                                                                   |
| Status   | Approved                                                                                               |
| Sources  | Product Book Doc 07 §15, Doc 16 (Active Sessions, Logout from All Devices, Session Timeout); D-04; O-5 |

## Business Goal

Let users see where they are signed in and end any session they don't recognise, for example a lost phone or a shared site tablet (Doc 07 §15).

## Description

A list of the user's active sessions, with the ability to end one or all other sessions. Sessions also end automatically after 8 hours of inactivity or 30 days in total (D-04).

## Actors

Every signed-in user.

## Preconditions

The user is signed in.

## User Flow

1. Open **Profile → Active sessions**.
2. See each session: device, browser, approximate location (IP address), signed in at, last active, and a "This device" marker.
3. Select **Sign out** on one session, or **Sign out of all other devices**.
4. The list updates; ended sessions stop working immediately.

## Functional Requirements

The system shall:

1. List only the user's own sessions that are not revoked and not expired, most recent activity first.
2. Mark the session making the request as the current one. It can't be ended from this list; the user uses Sign out (US-004).
3. End a single session (`revoked_reason = user_revoked`).
4. End all other sessions in one atomic batch.
5. Expire sessions automatically: idle for 8 hours, or 30 days after sign-in, whichever comes first (D-04). Expiry is checked on every request (T-2), so no background job is needed for correctness. A daily scheduled job removes the refresh-token hashes of long-expired sessions (the session rows themselves are kept for history).
6. Show the web app's "Your session has expired" screen when a request returns 401 because of expiry, then send the user to the login page and back to where they were after signing in.

## Validation Rules

- `sessionId` must be a UUID belonging to the signed-in user; otherwise 404 (no hint that it exists for someone else).

## Permission Rules

Users manage only their own sessions. Administrators ending other users' sessions comes with Administration (Sprint 19).

## Database Impact

Reads and updates `user_session` (defined in US-001). Writes `audit_log`.

## API Requirements

- `GET /api/v1/auth/sessions` → list of `{ id, deviceLabel, browser, ipAddress, createdAt, lastActivityAt, isCurrent }`.
- `DELETE /api/v1/auth/sessions/{sessionId}` → ends one session.
- `POST /api/v1/auth/sessions/revoke-others` → ends all others; `meta.revokedSessions` = count.

## UI Requirements

- Mobile: one card per session; desktop: a list (no horizontal scrolling — Doc 05 §16).
- Device and browser shown as icon **and** text.
- "This device" badge on the current session.
- **Sign out of all other devices** is the single primary action, shown only when other sessions exist. It asks for confirmation, because it affects other devices.
- Empty state: "You are only signed in on this device."
- Times shown relative ("2 hours ago") with the exact time on hover or tap, in the user's language and time zone (PLT-03).

## Error Handling

| Situation             | Message                                                               |
| --------------------- | --------------------------------------------------------------------- |
| Session already ended | Removed from the list without an error                                |
| Unknown session id    | "This session was not found."                                         |
| Network failure       | "We could not reach the server. Check your connection and try again." |

## Notifications

None in Sprint 1.

## Audit Requirements

`auth.session.revoked` for each ended session, with the reason; automatic expiry is not audited (it is derived from the stored times).

## Acceptance Criteria

- The user sees all of their active sessions, with the current one marked.
- Ending a session makes its tokens fail on the next request.
- "Sign out of all other devices" ends every session except the current one.
- A user can't see or end another user's sessions.
- After 8 hours idle, or 30 days after sign-in, the session stops working and the user is asked to sign in again.
- Audit records are written for every ended session.

## Test Scenarios

- **Positive:** list with three devices; end one; end all others.
- **Negative:** end another user's session id (404); end the current session through this endpoint (rejected); malformed id.
- **Boundary:** idle 7 h 59 min still valid, 8 h 01 min expired; 30 days minus 1 minute valid, 30 days plus 1 minute expired, even with continuous activity.

## Future Improvements

Approximate city from the IP address; push alert on new sign-in; administrator view of all company sessions.
