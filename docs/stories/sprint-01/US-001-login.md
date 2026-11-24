# US-001 — User Login

| Field    | Value                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security                                                                 |
| Priority | Must                                                                                                |
| Status   | Approved                                                                                            |
| Sources  | Product Book Doc 15 (example story), Doc 16, Doc 07 §13–15; D-03, D-04, D-05, D-08; T-1 to T-4, T-7 |

## Business Goal

Allow authorized users to securely access the platform. Only authenticated users may access protected resources (Doc 15).

## Description

The user enters their email and password on their company's subdomain (or the base domain for the System Owner, O-3). If the credentials are valid and the account may sign in, a session is created and the user is taken to their home page.

## Actors

Company Administrator, HSE Director, HSE Manager, Project Manager, Safety Officer, Site Engineer, Supervisor, Foreman, Inspector, Worker, Client, Consultant, Auditor (on a company subdomain); System Owner (on the base domain).

## Preconditions

- The user account exists and its status is Active.
- The user belongs to the company of the subdomain (or is a System Owner on the base domain).
- The company is active (PLT-02).

## User Flow

1. Open the login page.
2. Enter email.
3. Enter password.
4. Select **Sign in**.
5. The system validates the credentials and account state.
6. The system creates a session (refresh cookie + access token).
7. The user is redirected to the page they originally requested, or to the home page.
8. The login is recorded in the audit log.

## Functional Requirements

The system shall:

1. Authenticate by email and password. Email matching is case-insensitive.
2. Compare passwords with the constant-time hasher (Sprint 0) and transparently upgrade old hashes (`needsRehash`).
3. Apply the **lockout policy (D-05):** count consecutive failures per account; on the 5th failure set `locked_until = now + 15 minutes`; reset the counter on success or when the lock expires. A Company Admin or System Owner can unlock early (the unlock screen comes with Administration; until then via the System Owner console or the bootstrap tooling).
4. Refuse sign-in for status Pending Invitation, Suspended, Locked (admin lock) and Archived.
5. Create a `user_session` row with device, browser, IP, `idle_expires_at = now + 8 h` and `absolute_expires_at = now + 30 days` (D-04).
6. Return an access token (15 minutes, configurable) in the response body and set the refresh token as an `HttpOnly; Secure; SameSite=Strict` cookie (T-1).
7. Provide `POST /auth/refresh`, which validates the refresh cookie, checks the session is still valid and not idle-expired, **rotates** the refresh token, and returns a new access token. Reusing an already-rotated refresh token revokes the whole session (token theft detection).
8. On every authenticated request, check the session row (T-2): revoked, idle-expired or absolute-expired sessions get 401; suspended users get 401 immediately.
9. Apply per-IP rate limiting to `/auth/login` and `/auth/refresh` (T-7).
10. Provide `GET /auth/me` returning the signed-in user's profile and role assignments (full permissions arrive with Sprint 5).

## Validation Rules

- Email: required, valid format, at most 254 characters, trimmed and lowercased.
- Password: required, at most 128 characters. The complexity rules (D-03) are not checked at login, only when setting a password.
- Empty values are rejected.

## Permission Rules

- Anyone may view the login page.
- Only authenticated users may access protected pages and APIs.
- A company user can sign in only on their own company's subdomain; the System Owner only on the base domain (O-3).

## Database Impact

New table `user`:

| Column                                 | Type              | Notes                                                                          |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `id`                                   | TEXT (UUID)       | PK                                                                             |
| `company_id`                           | TEXT, nullable    | FK → `company`; null only for platform users (System Owner)                    |
| `email`                                | TEXT              | unique, stored lowercased                                                      |
| `full_name`                            | TEXT              |                                                                                |
| `password_hash`                        | TEXT              | `pbkdf2$sha256$…` format                                                       |
| `status`                               | TEXT              | `pending_invitation`, `active`, `suspended`, `locked`, `archived` (Doc 07 §13) |
| `preferred_language`                   | TEXT, nullable    | `en` / `ar` (D-21)                                                             |
| `time_zone`                            | TEXT, nullable    | falls back to the company time zone                                            |
| `failed_login_count`                   | INTEGER           | default 0                                                                      |
| `locked_until`                         | INTEGER, nullable | temporary lock (D-05)                                                          |
| `last_login_at`, `password_changed_at` | INTEGER, nullable |                                                                                |
| `workforce_member_id`                  | TEXT, nullable    | optional link (D-09); FK added in Sprint 7                                     |
| audit + soft-delete columns            |                   | standard                                                                       |

New table `user_session`:

| Column                                   | Type                     | Notes                                                                |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `id`                                     | TEXT (UUID)              | PK; carried in the access token as `sid`                             |
| `user_id`                                | TEXT                     | FK → `user`, indexed                                                 |
| `refresh_token_hash`                     | TEXT                     | SHA-256 of the current refresh token; unique                         |
| `previous_refresh_token_hash`            | TEXT, nullable           | detects reuse after rotation                                         |
| `device_label`, `browser`, `ip_address`  | TEXT                     | parsed from the request at sign-in                                   |
| `created_at`, `last_activity_at`         | INTEGER                  | `last_activity_at` written at most every 5 minutes (T-3)             |
| `idle_expires_at`, `absolute_expires_at` | INTEGER                  | D-04                                                                 |
| `revoked_at`, `revoked_reason`           | INTEGER / TEXT, nullable | `logout`, `user_revoked`, `password_changed`, `token_reuse`, `admin` |

Also writes `audit_log` (PLT-01).

## API Requirements

`POST /api/v1/auth/login`

- Input: `{ email, password }`
- Output `data`: `{ accessToken, accessTokenExpiresAt, user: { id, fullName, email, preferredLanguage, roles: [...] } }`; refresh token in the cookie.

`POST /api/v1/auth/refresh` — no body; uses the cookie. Output: `{ accessToken, accessTokenExpiresAt }`.

`GET /api/v1/auth/me` — the current user and role assignments.

## UI Requirements

The login page contains (Doc 15):

- Company logo and name (PLT-02), or the platform name on the base domain
- Email field (email keyboard on phones, autocomplete `username`)
- Password field with a **show password** toggle (autocomplete `current-password`)
- **Forgot password?** link (O-7)
- **Sign in** button with a loading indicator; disabled while submitting
- Language switcher (PLT-03)

Fully responsive, usable one-handed, with touch targets of at least 48 px (Doc 03 Rule 12), in Arabic and English.

## Error Handling

User-friendly messages, never technical detail (Doc 15):

| Situation                                         | Message                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| Wrong email or password                           | "Invalid email or password."                                          |
| Temporarily locked (correct password, O-1)        | "Too many failed attempts. Try again in {minutes} minutes."           |
| Suspended or admin-locked (correct password, O-1) | "Your account is not active. Contact your company administrator."     |
| Rate limited                                      | "Too many attempts. Please wait a moment and try again."              |
| Server unavailable                                | "We could not reach the server. Check your connection and try again." |

## Notifications

- New-device sign-in email: deferred (O-8).
- Repeated failed logins → administrator notification: deferred until the notification service (Sprint 6); the lock event is audited now.

## Audit Requirements

Record time, device, browser, IP address and success/failure (Doc 15): `auth.login.succeeded`, `auth.login.failed` (with the reason as a code; the email is stored only if it matches an account), `auth.account.locked`. Records are immutable (PLT-01).

## Acceptance Criteria

- A user can sign in successfully on their company subdomain and lands on the home page.
- Invalid credentials are rejected with the generic message.
- The 5th consecutive failure locks the account for 15 minutes; the account unlocks automatically afterwards.
- Suspended, archived, pending-invitation and admin-locked users cannot sign in.
- A user cannot sign in on another company's subdomain.
- Sessions are created with the correct idle and absolute expiry; an access token stops working when its session is revoked.
- Refresh rotates the token; reusing an old refresh token revokes the session.
- Audit records are written for success, failure and lock.
- The page works on mobile and desktop, in Arabic and English.

## Test Scenarios

**Positive:** valid email and password; upper-case email; session restored via refresh after reloading the page; redirect to the originally requested page; legacy hash upgraded.

**Negative:** wrong password; unknown email; empty fields; invalid email format; suspended, archived, admin-locked and temporarily locked accounts; correct password while temporarily locked; wrong subdomain; reused refresh token; refresh after 8 hours idle; refresh after 30 days.

**Boundary:** 254-character email accepted, 255 rejected; 128-character password accepted, 129 rejected; 4th failure does not lock, 5th does; access at 7 h 59 min idle succeeds, 8 h 01 min fails.

## Future Improvements

MFA, biometric login, SSO, passwordless and passkeys (Doc 15); Google/Microsoft sign-in (Doc 02 §3).
