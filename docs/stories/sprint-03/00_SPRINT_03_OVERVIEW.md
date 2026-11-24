# Sprint 3 — Users & Company Profile

**Status: DONE — accepted by the Product Owner on 2026-11-11 (D-39).** Approved by the Product Owner on 2026-11-11 (D-37), including technical decisions T-15 to T-21 and the proposed answers to open points O-21 to O-30 (D-38).

## Goal

A Company Administrator can invite colleagues by email, and invited users can activate their accounts. Every user can recover a forgotten password and keep their own profile up to date. The Company Administrator can maintain the company's profile, settings and logo.

## Scope

| ID     | Title                                     | Type             | Spec                                          |
| ------ | ----------------------------------------- | ---------------- | --------------------------------------------- |
| PLT-07 | File storage service v1 (R2)              | Platform enabler | [PLT-07](PLT-07-file-storage.md)              |
| PLT-08 | Company administration permissions (temp) | Platform enabler | [PLT-08](PLT-08-company-admin-permissions.md) |
| US-006 | User invitation                           | User story       | [US-006](US-006-user-invitation.md)           |
| US-002 | Forgot password                           | User story       | [US-002](US-002-forgot-password.md)           |
| US-003 | Reset password                            | User story       | [US-003](US-003-reset-password.md)            |
| US-007 | User profile                              | User story       | [US-007](US-007-user-profile.md)              |
| US-012 | Edit company profile                      | User story       | [US-012](US-012-edit-company.md)              |
| US-013 | Company settings                          | User story       | [US-013](US-013-company-settings.md)          |
| US-014 | Upload company logo                       | User story       | [US-014](US-014-company-logo.md)              |
| US-015 | Company information page                  | User story       | [US-015](US-015-company-information.md)       |

Ten items, the top of the Doc 14 size range (5–10).

**Out of scope:**

- Role and permission assignment beyond choosing one role at invitation (US-008, US-009: Sprint 5).
- Plan-limit enforcement on the number of users (Sprint 4), unless O-26 says otherwise.
- Payment proof upload (Sprint 4). PLT-07 is built so that Sprint 4 only adds a new file category.
- Suspending, archiving or deleting users, and administrators resetting another user's password (Administration, Sprint 19).
- Profile picture (Doc 16 lists "Change Profile Picture"; see O-25).
- Default notification preferences (Doc 08 §4) wait for the notification centre (Sprint 6).

## Decisions applied

D-02 (role catalogue), D-03 (password policy), D-04 and O-4 (sessions), D-05 (lockout), D-08 (one company per user), D-14 and D-21 (Arabic/English, language per user with a company default), D-16 (slug can't be changed after approval), D-28 (storage per plan), D-33 (Resend), O-7 (forgot-password placeholder is replaced), O-11 (file storage moves to this sprint). See [PO_DECISIONS.md](../../architecture/PO_DECISIONS.md).

## Technical decisions (proposed)

| ID   | Decision                                                                                                                                                                                                                                                                                           | Why                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| T-15 | An invitation creates the **`user` row at once** with status `pending_invitation`, no usable password and the chosen role. Accepting it sets the password and makes the user `active`. A separate `user_invitation` table keeps who invited whom, when, and the resend/revoke history.             | Doc 07 §13 already defines the `pending_invitation` status; the email stays reserved for that person (unique email, D-08).                     |
| T-16 | Invitation and password-reset links reuse the Sprint 2 **`one_time_token`** table (T-10) with new purposes `invitation` and `password_reset`.                                                                                                                                                      | One mechanism for every emailed link, as T-10 planned.                                                                                         |
| T-17 | Links in emails point to the **company's own subdomain** (`<slug>.<base>/invite/accept`, `<slug>.<base>/reset-password`). Forgot-password works on the base domain too, for the System Owner.                                                                                                      | The user lands where they will sign in, with the company's name and logo; tenant resolution (PLT-02) checks the token belongs to that company. |
| T-18 | Files go through **one `FileStorageService`** (Master Rules §5): upload is a `multipart/form-data` request to the API, which checks size and the real file type (magic bytes), stores the object in R2 under a generated key and the metadata in a new `file` table. Downloads go through the API. | One upload system, files never public, tenant checked on every download. Presigned direct-to-R2 uploads can come later for large files.        |
| T-19 | Storage use is **counted per company** (`file.size_bytes` summed) from the start, but the D-28 quota is enforced only in Sprint 4 with the other plan limits.                                                                                                                                      | Sprint 4 can enforce limits without a data back-fill.                                                                                          |
| T-20 | Until the permission matrix exists (Sprint 5), company endpoints use a **temporary checker** that grants `company.*` and `users.*` at company scope to the `company_administrator` role and denies everything else. It extends T-14; Sprint 5 replaces both.                                       | Deny by default, and route code won't change when the real matrix arrives.                                                                     |
| T-21 | Forgot-password **always answers the same way** and is rate-limited per IP and per email. A reset revokes every session of the user, like a password change (O-4).                                                                                                                                 | No account enumeration (same rule as Sprint 2 resend); a reset after a stolen password must sign the thief out.                                |

## Open points for Product Owner approval

| ID   | Question                                                                       | Proposed answer                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-21 | How long is an invitation link valid?                                          | **7 days.** The administrator can resend it (new link, old one stops working) or cancel it.                                                                                                                                                       |
| O-22 | How long is a password-reset link valid?                                       | **1 hour**, single use.                                                                                                                                                                                                                           |
| O-23 | Which roles can the Company Administrator pick when inviting, before Sprint 5? | **Any company-level role from D-02 except System Owner**, one role per user. The roles are stored now, but until Sprint 5 only Company Administrator grants extra rights; others can sign in, see their profile and the company information page. |
| O-24 | Can there be more than one Company Administrator?                              | **Yes.** An administrator can invite another administrator. The last active administrator can't be removed (applies from Sprint 5, when roles can be changed).                                                                                    |
| O-25 | Profile picture (Doc 16): in this sprint?                                      | **No, later** (with Administration, Sprint 19). It needs image resizing and moderation questions; the avatar shows initials meanwhile.                                                                                                            |
| O-26 | Should inviting a user check the plan's user limit (Basic 25, Pro 100) now?    | **Yes, a simple check now**: active plus pending users can't exceed the plan limit, with a clear message. The rest of plan-limit enforcement stays in Sprint 4.                                                                                   |
| O-27 | What can a user change in their own profile?                                   | **Full name, phone number, language and time zone.** Email can't be changed by the user in Phase 1 (it is the sign-in name; an administrator flow comes later).                                                                                   |
| O-28 | Which company settings ship now (Doc 08 §4)?                                   | **Default language, date format, time format (12/24 h), first day of the working week, and working days.** Notification preferences wait for Sprint 6; branding is the logo (US-014).                                                             |
| O-29 | Can the Company Administrator change the company name and the subdomain?       | **Name: yes**, audited. **Subdomain: no** (D-16), the page shows it read-only with "contact support to change it".                                                                                                                                |
| O-30 | Logo file rules?                                                               | **PNG, JPEG or WebP only** (no SVG, because it can carry scripts), **max 2 MB**, shown at up to 256 × 256. A square or wide logo is recommended.                                                                                                  |

## Data model introduced

| Table                | Purpose                                                                                | Spec           |
| -------------------- | -------------------------------------------------------------------------------------- | -------------- |
| `file`               | Metadata for every stored file: company, category, R2 key, type, size, uploader        | PLT-07         |
| `user_invitation`    | Invitation history: invited user, invited by, role, sent / resent / accepted / revoked | US-006         |
| `company_settings`   | Date format, time format, week start, working days (one row per company)               | US-013         |
| `one_time_token`     | New purposes `invitation` and `password_reset`                                         | US-006, US-002 |
| `user` (extended)    | Adds `phone`                                                                           | US-007         |
| `company` (extended) | Adds `registration_number`, `address`; `logo_file_id` gets its foreign key to `file`   | US-012, US-014 |

## API introduced

All under `/api/v1`, standard envelope.

| Method & path                               | Context                        | Story          |
| ------------------------------------------- | ------------------------------ | -------------- |
| `GET /users`                                | company, Company Administrator | US-006         |
| `POST /users/invitations`                   | company, Company Administrator | US-006         |
| `POST /users/{id}/invitation/resend`        | company, Company Administrator | US-006         |
| `DELETE /users/{id}/invitation`             | company, Company Administrator | US-006         |
| `GET /invitations?token=`                   | company, public                | US-006         |
| `POST /invitations/accept`                  | company, public                | US-006         |
| `POST /auth/forgot-password`                | any, public                    | US-002         |
| `GET /auth/reset-password?token=`           | any, public                    | US-003         |
| `POST /auth/reset-password`                 | any, public                    | US-003         |
| `GET /auth/me`, `PATCH /auth/me` (extended) | signed in                      | US-007         |
| `GET /company`                              | company, signed in             | US-015         |
| `PATCH /company`                            | company, Company Administrator | US-012         |
| `GET /company/settings`                     | company, signed in             | US-013         |
| `PUT /company/settings`                     | company, Company Administrator | US-013         |
| `PUT /company/logo`, `DELETE /company/logo` | company, Company Administrator | US-014         |
| `GET /files/{id}`                           | company, signed in             | PLT-07         |
| `GET /company/logo`                         | company, public                | US-014, PLT-07 |

## Screens introduced

| Screen                        | Where                         | Story          |
| ----------------------------- | ----------------------------- | -------------- |
| Users (list, invite, pending) | `<slug>/settings/users`       | US-006         |
| Accept invitation             | `<slug>/invite/accept`        | US-006         |
| Forgot password (real form)   | `<any>/forgot-password`       | US-002         |
| Reset password                | `<any>/reset-password`        | US-003         |
| My profile                    | `<any>/profile`               | US-007         |
| Company profile and logo      | `<slug>/settings/company`     | US-012, US-014 |
| Company settings              | `<slug>/settings/preferences` | US-013         |
| Company information           | `<slug>/company`              | US-015         |

The company logo also replaces the platform mark on the company's sign-in page and in the app header.

## Definition of Done

- Every acceptance criterion in the ten specs passes.
- Unit tests for services; integration tests for each endpoint against the local runtime, including R2 uploads with real and forged file types.
- Browser check in **Arabic and English** at phone width: invite → accept → sign in; forgot → reset → sign in (company user and System Owner); edit profile; edit company, settings and logo, and see the logo on the sign-in page.
- `npm run check` and `npm run build` pass; migrations apply cleanly to a fresh local D1 and on top of the Sprint 2 data.
- `03_DATABASE.md`, `04_API.md` and the Cloudflare notes (R2 bucket per environment) are updated.

## Implementation notes

### Refinements made during implementation (for acceptance)

| Item                     | Approved text                                    | As built                                                                                                                                               | Why                                                                                                                                    |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| US-014 logo foreign key  | `logo_file_id` gets its foreign key to `file`    | No database foreign key; the file service checks the company on every read.                                                                            | SQLite can add a foreign key only by rebuilding the `company` table, which other tables reference.                                     |
| PLT-07 module placement  | —                                                | Company profile, settings, logo and file routes live in a new `company-admin` module.                                                                  | It depends on identity (sign-in, permissions), and identity depends on the company module; a separate module avoids a circular import. |
| US-006 users list        | Cards on phones, a table from tablet width       | Cards at every width.                                                                                                                                  | Same information and actions; a table can come with the full user administration (Sprint 19).                                          |
| US-006 invite form       | A drawer                                         | A native dialog: full screen on phones, a panel from tablet width.                                                                                     | Native focus trapping and Escape, like the other dialogs.                                                                              |
| US-006 seat count (O-26) | Active plus pending users                        | Active, pending, locked and suspended users all take a seat; archived (cancelled) don't.                                                               | A suspended user can be reactivated, so they still occupy a place in the plan.                                                         |
| US-007 time zone default | "Use company default" (D-21 is about language)   | Time zone can also follow the company; platform users default to `Asia/Riyadh`.                                                                        | One rule for both fields.                                                                                                              |
| US-013 date formatting   | The web app formats every date with the settings | New screens (users, profile, company, preferences) use the company formats; Sprint 1/2 screens (sessions, registration queue) keep the browser format. | Those screens are moved over as they're next touched.                                                                                  |
| US-005 notification      | Deferred in Sprint 1                             | `auth.password_changed` is now emailed after a password change too.                                                                                    | US-003 Notifications.                                                                                                                  |

### Added beyond the specs

- A shared `useLoad` hook and `LoadStatus` component for screens that load data; `FileDropzone` (PLT-07 UI); `CompanyOnly` guard; `RequirePermission` guard and `hasPermission()` for menus.
- The tenant profile can be reloaded (`useReloadTenant`), so a new name, language or logo shows at once in the header.
- The API client sends `FormData` uploads and accepts `204 No Content`.
- After sign-in, `lastLoginAt` in the response is the current sign-in (found in the browser check).

### Known gaps

- CI web build: `NEXT_PUBLIC_API_BASE_URL` in `.github/workflows/ci.yml` is still an absolute URL (pre-existing, Sprint 2 gap).
- Storage quota (D-28) is counted but not enforced until Sprint 4 (T-19).
- Seeded dev companies have no subscription, so their information page shows plan "Not set" and storage limit 0; approved companies have one.
- Arabic file-type error lists the types with a Latin comma ("PNG, JPEG, WEBP"), as sent by the API.

### Verification

- `npm run check` passes: formatting, lint (incl. translation keys and logical CSS), typecheck, shared 43 tests and API 154 tests (29 new: invitations 12, password reset 9, profile/company/logo/files 8). `npm run build` passes.
- Migration `0004` applied to the existing local D1 with Sprint 2 data.
- Browser (local dev, 375 px), `EMAIL_PROVIDER=log`:
  - Arabic, as the demo Company Administrator: home shows the administration links; users, company profile, preferences, company information and profile pages render right-to-left with no sideways scroll.
  - Invite (Arabic invitation, Safety Officer role with its description) → listed as pending, expires in 7 days → Arabic email with a link on `demo.localhost` → accept page shows company, name and email → set password → signed in; no administration links for a Safety Officer.
  - English: forgot password → same confirmation message → reset email in the user's language → masked email on the reset page → new password → old session ended (refresh 401), new password signs in.
  - Logo: PNG uploaded → header logo replaced at once and served as `image/png` → a PDF renamed `.png` refused with the Arabic message. Company profile saved right after the logo change without a false conflict; preferences saved (`YYYY-MM-DD`, 12-hour) and the preview follows.
- Not checked in the browser: the System Owner's reset on the base domain and the resend/cancel buttons (covered by integration tests), and screenshots (the browser pane was hidden, so checks used page text and the DOM).
