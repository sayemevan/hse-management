# US-003 — Reset Password

| Field    | Value                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security                                                         |
| Priority | Must                                                                                        |
| Status   | Approved                                                                                    |
| Sources  | Product Book Doc 14, Doc 16 (Reset Password), Doc 07 §15; D-03, D-05, O-4; T-16, T-21; O-22 |

## Business Goal

Let a user set a new password safely from the link they received (US-002).

## Description

The link opens a form where the user sets a new password. All existing sessions are ended, and the user signs in with the new password.

## Actors

A user holding a valid reset link.

## Preconditions

A `password_reset` token that is unused and less than 1 hour old, for an `active` user.

## User Flow

1. Open the link (`<host>/reset-password?token=…`).
2. Enter and confirm the new password (live D-03 checklist).
3. Select **Set new password**.
4. See "Your password has been changed. Sign in with your new password." with a button to the sign-in page, email pre-filled.

If the link is expired or used: "This link has expired or was already used", with a link to request a new one.

## Functional Requirements

The system shall:

1. Check the token on page load without consuming it (`GET`), so an email scanner opening the link changes nothing.
2. On submit, in one batch: consume the token, store the new hash, set `password_changed_at`, clear `failed_login_count` and `locked_until`, and revoke **every** session of the user (`revoked_reason = password_reset`, T-21).
3. Enforce D-03 and reject the current password as the new one.
4. Check the token belongs to the tenant of the request (company subdomain) or to a platform user (base domain).
5. Not sign the user in automatically (the user proves the new password once at sign-in).

## Validation Rules

- New password: D-03 policy, 8–128 characters.
- Confirmation matches (browser only).
- Must differ from the current password.

## Permission Rules

Anyone with the link (the token is the credential).

## Database Impact

Updates `user`, `user_session`, `one_time_token`; adds `password_reset` to `SESSION_REVOKE_REASONS`; writes `audit_log`, `email_outbox`.

## API Requirements

- `GET /api/v1/auth/reset-password?token=` → `{ email }` (masked, e.g. `s•••@example.com`) or `TOKEN_INVALID_OR_EXPIRED`.
- `POST /api/v1/auth/reset-password` with `{ token, password }` → `{ revokedSessions }`.

## UI Requirements

Same password fields and checklist as US-005 (shared component); `autocomplete="new-password"`. Arabic and English, phone width.

## Error Handling

| Situation                   | Message                                                         |
| --------------------------- | --------------------------------------------------------------- |
| Link invalid, used, expired | "This link has expired or was already used. Request a new one." |
| Policy not met              | The specific rule(s) not met                                    |
| Same as current             | "Choose a password you are not using now."                      |

## Notifications

`auth.password_changed` to the user: "Your password was changed on {date}. If this wasn't you, reset it now and contact your administrator." Also sent by US-005 from now on (its deferred notification).

## Audit Requirements

`auth.password.reset` and `auth.session.revoked` per ended session.

## Acceptance Criteria

- A valid link lets the user set a compliant password once; the old password stops working.
- All sessions on all devices are ended.
- A locked account is unlocked by the reset.
- An expired, used or superseded link doesn't work; opening the link alone changes nothing.

## Test Scenarios

- **Positive:** reset then sign in; reset unlocks a locked account; other devices signed out.
- **Negative:** token 1 h + 1 min old; token used twice; earlier token after a second request; token of another purpose (invitation); company user's token on another subdomain; weak or same password.
- **Boundary:** 8 and 128 characters accepted; 7 and 129 rejected.

## Future Improvements

Breached-password check (as US-005).
