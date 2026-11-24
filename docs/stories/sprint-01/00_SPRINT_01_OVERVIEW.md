# Sprint 1 — Identity Core & Cross-Cutting Foundations

**Status: DONE — accepted by the Product Owner on 2026-11-11 (D-25).** Approved on 2026-11-11, including the proposed answers to open points O-1 to O-10 and technical decisions T-1 to T-7. See [Implementation notes](#implementation-notes) for refinements and known gaps.

## Goal

A user can sign in on their company's subdomain, in Arabic or English, stay signed in according to the session policy, see and end their sessions, change their password, and sign out. Every security event is written to an immutable audit log.

## Scope

| ID     | Title                                       | Type             | Spec                                       |
| ------ | ------------------------------------------- | ---------------- | ------------------------------------------ |
| PLT-01 | Audit Log service                           | Platform enabler | [PLT-01](PLT-01-audit-log.md)              |
| PLT-02 | Tenant resolution from subdomain            | Platform enabler | [PLT-02](PLT-02-tenant-resolution.md)      |
| PLT-03 | Arabic/English and right-to-left foundation | Platform enabler | [PLT-03](PLT-03-i18n-rtl.md)               |
| PLT-04 | System Owner bootstrap                      | Platform enabler | [PLT-04](PLT-04-system-owner-bootstrap.md) |
| US-001 | User Login                                  | User story       | [US-001](US-001-login.md)                  |
| US-004 | Logout                                      | User story       | [US-004](US-004-logout.md)                 |
| US-005 | Change Password                             | User story       | [US-005](US-005-change-password.md)        |
| US-010 | Session Management                          | User story       | [US-010](US-010-session-management.md)     |

**Out of scope:** registration and company creation (Sprint 2), invitations and forgot/reset password (Sprint 3), roles and permission assignment (Sprint 5), email sending (Sprint 2+), MFA and SSO (Doc 16, out of scope for Phase 1).

## Decisions applied

D-02 roles, D-03 password policy, D-04 sessions, D-05 lockout, D-06 subdomains, D-08 one company per user, D-14 Arabic in Phase 1, D-16 slug rules, D-21 language preference. See [PO_DECISIONS.md](../../architecture/PO_DECISIONS.md).

## Technical decisions (proposed)

| ID  | Decision                                                                                                                                                                                                                                                                        | Why                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | **Two tokens.** A short-lived access token (JWT, 15 minutes, configurable) is held in memory by the web app. A long-lived refresh token (random, opaque) is stored only as a hash in the database and sent to the browser as an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. | Doc 15 requires an access and a refresh token. Keeping the refresh token out of JavaScript protects it from XSS.                        |
| T-2 | **Every authenticated request checks the session in the database** (not just the token signature).                                                                                                                                                                              | Doc 07 §13: suspended users must lose access _immediately_; a 15-minute token alone can't guarantee that.                               |
| T-3 | `last_activity_at` is written **at most once every 5 minutes** per session.                                                                                                                                                                                                     | Keeps the 8-hour idle rule accurate without a database write on every request.                                                          |
| T-4 | The API is served **on the same site** as the web app (for example `api.<base-domain>`), and the refresh endpoint also checks the `Origin` header.                                                                                                                              | `SameSite=Strict` cookies then work across company subdomains and block cross-site request forgery.                                     |
| T-5 | Audit records are **append-only, enforced by the database**: SQLite triggers reject any `UPDATE` or `DELETE` on the audit table.                                                                                                                                                | Master Rules: "Audit history cannot be modified". Enforced below the application, so a bug can't break it.                              |
| T-6 | **i18n library: `next-intl`.** Language is stored in a cookie and the user profile, **not in the URL** (no `/ar/...` prefix).                                                                                                                                                   | Most mature App Router i18n library; keeps URLs identical per company subdomain. A new dependency, justified per the Dependency Policy. |
| T-7 | Login attempts are also **rate-limited per IP address** with Cloudflare's Workers rate-limiting binding.                                                                                                                                                                        | Doc 02 §11: rate limiting for sensitive endpoints. The per-account lock (D-05) alone doesn't stop attacks spread over many accounts.    |

## Open points for Product Owner approval

| ID   | Question                                                                                                                                                  | Proposed answer                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| O-1  | Should a locked or suspended account show "Account locked" / "Account suspended" even when the password is wrong? Doing so reveals that the email exists. | **No.** Show the specific message only when the password is correct; otherwise always "Invalid email or password."              |
| O-2  | Doc 07 has an account status "Locked". Is that the same as the automatic 15-minute lock (D-05)?                                                           | **No.** The automatic lock is temporary (`locked_until`). Status "Locked" means an admin locked the account and must unlock it. |
| O-3  | Where does the System Owner sign in?                                                                                                                      | On the **base domain** (`<base-domain>/login` → platform console). Company users sign in only on their own subdomain.           |
| O-4  | After a password change, should other devices be signed out?                                                                                              | **Yes.** All other sessions end; the current one stays.                                                                         |
| O-5  | Can a user stay signed in on unlimited devices (D-04 said yes)?                                                                                           | **Yes**, confirmed. All sessions are visible and can be ended in US-010.                                                        |
| O-6  | Arabic font?                                                                                                                                              | **IBM Plex Sans Arabic** with IBM Plex Sans for Latin text (open licence, good legibility on small screens).                    |
| O-7  | Forgot Password link on the login page: hide it until Sprint 3?                                                                                           | **Show it**, leading to a page saying "Contact your company administrator" until US-002 ships.                                  |
| O-8  | New-device login email (Doc 15 "optional")?                                                                                                               | **Defer** until email sending exists (Sprint 2/3); record the event in the audit log now.                                       |
| O-9  | Audit every token refresh? (PLT-01)                                                                                                                       | **No** — only failed refreshes (reuse of a revoked token). Sessions already record last activity.                               |
| O-10 | Digits in Arabic: Western (0–9) or Eastern Arabic (٠–٩)? (PLT-03)                                                                                         | **Western digits** in both languages, so record numbers and dates match in reports and search.                                  |

## Data model introduced

| Table          | Purpose                                                                                                    | Spec           |
| -------------- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| `company`      | Minimal tenant record (id, name, slug, status, default language). Extended in Sprint 2.                    | PLT-02         |
| `user`         | Identity, password hash, status, language, lockout counters                                                | US-001         |
| `user_role`    | Role held by a user, with scope (platform / company / project). Only System Owner is assigned in Sprint 1. | PLT-04         |
| `user_session` | One row per signed-in device                                                                               | US-001, US-010 |
| `audit_log`    | Immutable security and business event log                                                                  | PLT-01         |

## API introduced

All under `/api/v1`, standard envelope.

| Method & path                                                | Story  |
| ------------------------------------------------------------ | ------ |
| `POST /auth/login`                                           | US-001 |
| `POST /auth/refresh`                                         | US-001 |
| `POST /auth/logout`                                          | US-004 |
| `POST /auth/change-password`                                 | US-005 |
| `GET /auth/sessions`                                         | US-010 |
| `DELETE /auth/sessions/{sessionId}`                          | US-010 |
| `POST /auth/sessions/revoke-others`                          | US-010 |
| `GET /auth/me`                                               | US-001 |
| `GET /tenant` (public: company name, logo, default language) | PLT-02 |

## Definition of Done

- Every acceptance criterion in the eight specs passes.
- Unit tests for services; integration tests for each endpoint against a local D1.
- Login, change password and sessions screens checked on a phone-width screen in **both Arabic (RTL) and English**.
- `npm run check` and `npm run build` pass; migrations apply cleanly to a fresh local D1.
- Docs updated: `03_DATABASE.md` (tables), `04_API.md` (endpoints).

## Implementation notes

### Refinements made during implementation (for acceptance)

| Item        | Approved text                                       | As built                                                                                                                                                    | Why                                                                                                         |
| ----------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| T-4         | API on the same site, e.g. `api.<base-domain>`      | API on the **same origin**: `<slug>.<base-domain>/api/*` is routed to the API Worker (a Workers route); locally the Next.js dev server proxies `/api/*`     | Stronger: cookies are first-party, no CORS is needed, and the API sees the real host for tenant resolution. |
| PLT-02 FR-1 | Web app forwards the host in `x-tenant-host`        | Standard `x-forwarded-host`, trusted only when `TRUST_FORWARDED_HOST=true` (the config refuses this in production)                                          | Same purpose with the header proxies already set; production uses the real `Host`.                          |
| US-001 FR-7 | Reusing a rotated refresh token revokes the session | Same, except inside a **30-second grace window** (configurable), where a parallel tab gets an access token without another rotation                         | Otherwise two tabs refreshing at once would sign the user out as a "stolen token".                          |
| PLT-02 AC   | Repositories can't be called without a tenant       | The sign-in lookup is tenant-scoped in the repository. Session lookups are by id, and the service checks the tenant so it can audit cross-company attempts. | Keeps `tenant.access.denied` auditable.                                                                     |

### Added beyond the specs

- `npm run db:seed:dev --workspace @hse/api`: local-only sample data (two companies, three users, a dev System Owner). The password is in `apps/api/scripts/seed-dev.ts`.
- Lint checks: no hard-coded JSX text (`react/jsx-no-literals`), no physical left/right classes, and matching translation keys (`scripts/check-web-i18n.mjs`).

### Known gaps

- **Emails** (new-device sign-in, password changed): deferred per O-8 until email sending exists.
- **Early unlock by an administrator** (D-05): no screen yet (Administration, Sprint 19). An operator can clear `locked_until` in the database.
- **Company logo**: shown once file storage exists (Sprint 2); a building icon is used meanwhile.
- **Approximate location from IP** in the sessions list: a future improvement, not built.
- **Console 401 on an anonymous page load**: the silent session check calls `/auth/refresh`; with no cookie the API answers 401 and the browser logs it. Harmless.
- The language choice is remembered **per subdomain** on a device (cookies are host-only). The saved profile preference applies everywhere after sign-in.

### Verification

- API: 89 tests (unit, plus integration tests against an in-memory local D1), including the exact limits for lockout, idle and absolute session expiry, password rules, and email/password lengths.
- Shared: 34 tests (password policy, slug rules, request schemas).
- Browser (local dev on `demo.localhost` and `localhost`): failed and successful sign-in, session restore on reload, sessions list, Arabic RTL at 375 px, change-password errors, sign-out, return to the requested page after sign-in, unknown-subdomain page, System Owner sign-in on the base domain.
- PLT-04 bootstrap against the local D1: weak password rejected, owner created with role and audit record, second run refused.
