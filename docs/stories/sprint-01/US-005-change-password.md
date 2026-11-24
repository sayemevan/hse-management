# US-005 — Change Password

| Field    | Value                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security                                                                               |
| Priority | Must                                                                                                              |
| Status   | Approved                                                                                                          |
| Sources  | Product Book Doc 14, Doc 16 (User Profile → Change Password; Password Policy); Master Rules MASTER_RULES_02; D-03 |

## Business Goal

Let users keep their account secure by changing their password whenever they need to.

## Description

A signed-in user enters their current password and a new password that meets the policy. Other devices are signed out (O-4).

## Actors

Every signed-in user.

## Preconditions

The user is signed in.

## User Flow

1. Open **Profile → Change password**.
2. Enter the current password.
3. Enter the new password and confirm it.
4. Select **Change password**.
5. The system validates and saves the new password.
6. Other sessions are ended; the user stays signed in here and sees a success message.
7. The change is recorded in the audit log.

## Functional Requirements

The system shall:

1. Verify the current password. Wrong current passwords count towards the lockout policy (D-05), so this screen can't be used to guess passwords.
2. Enforce the password policy (D-03) on the new password.
3. Reject a new password equal to the current one.
4. Store the new hash and set `password_changed_at`.
5. Revoke all other sessions of the user (`revoked_reason = password_changed`) in the same atomic batch, and keep the current one (O-4).
6. Show live feedback for each policy rule while the user types.

## Validation Rules

- Current password: required.
- New password (D-03): at least 8 characters and at most 128; must contain at least one uppercase letter, one lowercase letter, one number and one symbol.
- New password must differ from the current password.
- Confirmation must match the new password.
- Validated in the browser for feedback **and** on the server (Doc 03 Rule 9: never trust client data).

## Permission Rules

A user may change only their own password. Administrators resetting other users' passwords is handled with Administration (Sprint 19).

## Database Impact

Updates `user.password_hash`, `user.password_changed_at`; updates `user_session` rows (revocation). Writes `audit_log`.

## API Requirements

`POST /api/v1/auth/change-password`

- Input: `{ currentPassword, newPassword }` (the confirmation is checked in the browser only).
- Output: success envelope; `meta.revokedSessions` = number of other sessions ended.

## UI Requirements

- Three password fields, each with a show/hide toggle; correct `autocomplete` values (`current-password`, `new-password`) so password managers work.
- A checklist of the password rules that ticks off as the user types (icon **and** text, not colour alone — Doc 03 Rule 14).
- Required-field indicators and inline errors (UI/UX rules).
- Success message: "Your password has been changed. You have been signed out on other devices."

## Error Handling

| Situation               | Message                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| Current password wrong  | "Your current password is incorrect."                                        |
| Policy not met          | The specific rule(s) not met                                                 |
| Same as current         | "Choose a password you are not using now."                                   |
| Too many wrong attempts | Locked per D-05: "Too many failed attempts. Try again in {minutes} minutes." |

## Notifications

"Your password was changed" email: deferred until email sending exists (Sprint 2/3).

## Audit Requirements

`auth.password.changed` (never the password or hash), and `auth.session.revoked` for the sessions it ended.

## Acceptance Criteria

- The user can change their password with the correct current password and a compliant new password.
- The old password no longer works; the new one does.
- Other sessions are signed out; the current one stays active.
- Each policy rule is enforced by the server even if the browser is bypassed.
- Wrong current passwords count towards the lockout.
- Audit records are written.

## Test Scenarios

- **Positive:** valid change; other sessions revoked; sign in with the new password.
- **Negative:** wrong current password; new password missing an uppercase letter / lowercase letter / number / symbol; 7 characters; same as current; mismatched confirmation; 5 wrong current passwords lock the account.
- **Boundary:** 8 and 128 characters accepted; 7 and 129 rejected.

## Future Improvements

Checking new passwords against known breached passwords; password history (not required by D-03).
