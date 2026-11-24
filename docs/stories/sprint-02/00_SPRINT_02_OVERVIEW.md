# Sprint 2 — Company Registration & Verification

**Status: DONE — accepted by the Product Owner on 2026-11-11 (D-36).** Approved on 2026-11-11 (D-34), including technical decisions T-8 to T-14 and the proposed answers to open points O-11 to O-20. See [Implementation notes](#implementation-notes) for refinements and known gaps.

## Goal

A company can register itself on the platform with its own subdomain. The applicant verifies their email, and the System Owner reviews the application. The System Owner either approves it, which starts the 14-day trial and gives the applicant a working Company Administrator account, or rejects it with a reason, which the applicant can fix and resubmit.

## Scope

| ID       | Title                                          | Type             | Spec                                          |
| -------- | ---------------------------------------------- | ---------------- | --------------------------------------------- |
| PLT-05   | Email service (Resend, queued, Arabic/English) | Platform enabler | [PLT-05](PLT-05-email-service.md)             |
| PLT-06   | Plan catalogue & trial subscription            | Platform enabler | [PLT-06](PLT-06-plans-and-trial.md)           |
| US-011.1 | Register a company                             | User story       | [US-011.1](US-011.1-register-company.md)      |
| US-011.2 | Verify registration email                      | User story       | [US-011.2](US-011.2-verify-email.md)          |
| US-011.3 | Approve a registration                         | User story       | [US-011.3](US-011.3-approve-registration.md)  |
| US-011.4 | Reject a registration                          | User story       | [US-011.4](US-011.4-reject-registration.md)   |
| US-011.5 | Resubmit a rejected registration               | User story       | [US-011.5](US-011.5-resubmit-registration.md) |

US-011 "Create Company" (Doc 14) is replaced by US-011.1–011.5 because of D-06 (self-registration with approval).

**Out of scope:**

- Payment proof and payment confirmation (O-11, proposed for Sprint 4).
- File storage and the company logo (O-11, proposed for Sprint 3).
- Enforcing trial expiry and read-only mode (Sprint 4).
- Invitations and password reset (Sprint 3).
- SMS (D-32).

## Decisions applied

D-06 and D-29 (self-registration, approval, trial), D-16 (slug rules), D-17, D-27 and D-28 (plans), D-31 (reject and resubmit), D-32 (email-only verification), D-33 (Resend), D-08 (one company per user), D-14 and D-21 (Arabic/English). See [PO_DECISIONS.md](../../architecture/PO_DECISIONS.md).

## Technical decisions (proposed)

| ID   | Decision                                                                                                                                                                                                                           | Why                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T-8  | An application is stored as a **`company_registration`** record. The real `company`, `user`, role and subscription are created **only on approval**, in one atomic batch.                                                          | Unapproved applicants never become tenants or users, so nothing has to be cleaned up after a rejection, and the identity rules from Sprint 1 stay unchanged. |
| T-9  | Email is sent through one **`EmailService`** interface. Requests only **enqueue** a message on the `JOBS` queue; a queue consumer sends it through Resend, retrying with backoff. Development and tests use a **log-only sender**. | Master Rules §6 (one notification service); sending never slows down or fails a user request; the provider can be swapped (ADR-002).                         |
| T-10 | Verification and resubmission links use **single-use tokens**: 256-bit random values, stored only as SHA-256 hashes in a generic `one_time_token` table with a purpose and an expiry, and consumed atomically.                     | The same mechanism serves invitations and password reset in Sprint 3.                                                                                        |
| T-11 | The public registration form is protected by **Cloudflare Turnstile** (verified on the server), plus per-IP rate limiting.                                                                                                         | Public sign-up forms attract bots; Turnstile is free and has no puzzles for real users. It is a new service, so it is listed for approval.                   |
| T-12 | Email templates live in the API and come in **English and Arabic**, with an HTML version (`dir="rtl"` for Arabic) and a plain-text version.                                                                                        | D-14; many site phones show plain text.                                                                                                                      |
| T-13 | Plans are **seeded data** (a migration), not code constants. Prices are nullable until F-02b is decided.                                                                                                                           | D-27 and D-28: "stored as plan data".                                                                                                                        |
| T-14 | Until the permission matrix exists (Sprint 5), System Owner endpoints are guarded by a **temporary permission checker** that grants `platform.registrations.*` to the `system_owner` platform role and denies everything else.     | Keeps "deny by default" and uses the Sprint 0 `requirePermission()` API, so Sprint 5 only swaps the checker.                                                 |

## Open points for Product Owner approval

| ID   | Question                                                                                                              | Proposed answer                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-11 | With the 14-day trial (D-29), payment isn't needed at registration. Should payment-proof upload move out of Sprint 2? | **Yes.** Payment proof and confirmation go to **Sprint 4** (subscription lifecycle), and file storage to **Sprint 3**, where the company logo first needs it.                                                          |
| O-12 | When does the applicant set their password?                                                                           | **At registration.** It is stored as a hash on the application and becomes the Company Administrator's password on approval, so no extra email step is needed.                                                         |
| O-13 | When is the plan chosen, and when the billing cycle (monthly or annual)?                                              | **Plan at registration** (it can be changed by the System Owner during review). **Billing cycle at payment** (Sprint 4).                                                                                               |
| O-14 | Must the applicant accept Terms of Service and a Privacy Policy?                                                      | **Yes**, with a required checkbox and links. The Product Owner provides the texts, which are needed before go-live but not for development; placeholders are used until then.                                          |
| O-15 | How long do unfinished applications live?                                                                             | **Unverified:** removed after 7 days. **Rejected and not resubmitted:** the resubmission link works for 30 days, after which the application is closed. It is kept for the audit trail, and its subdomain is released. |
| O-16 | Is the chosen subdomain reserved while an application is pending?                                                     | **Yes.** It can't be taken by anyone else until the application is approved, closed or expired.                                                                                                                        |
| O-17 | Country and time zone fields?                                                                                         | **Country:** a list with Saudi Arabia first, then the other GCC countries, then all others. **Time zone:** pre-filled from the country (Asia/Riyadh for Saudi Arabia) and changeable.                                  |
| O-18 | Who is told about a new application?                                                                                  | **Every System Owner, by email**, and it appears in the review queue.                                                                                                                                                  |
| O-19 | Which language do the applicant's emails use?                                                                         | **The language the applicant used on the registration page.**                                                                                                                                                          |
| O-20 | Trials can't end until Sprint 4 enforces expiry. Is that acceptable for the time between Sprints 2 and 4?             | **Yes, for development only.** No real customer is onboarded before Sprint 4 is done.                                                                                                                                  |

## Data model introduced

| Table                  | Purpose                                                                         | Spec               |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------ |
| `plan`                 | Basic / Pro / Enterprise with limits, plus prices once known                    | PLT-06             |
| `subscription`         | One per company: plan, status (`trial` in Sprint 2), trial dates                | PLT-06             |
| `company_registration` | The application: company details, applicant, chosen plan, status                | US-011.1           |
| `registration_review`  | History of approve/reject decisions with reasons                                | US-011.3, US-011.4 |
| `one_time_token`       | Hashed single-use tokens (email verification, resubmission; reused in Sprint 3) | US-011.2           |
| `email_outbox`         | Every email requested: template, recipient, language, status, provider id       | PLT-05             |
| `company` (extended)   | Adds `country_code`, `city`, `contact_email`, `contact_phone`                   | US-011.3           |

## API introduced

All under `/api/v1`, standard envelope.

| Method & path                                | Context                | Story    |
| -------------------------------------------- | ---------------------- | -------- |
| `GET /plans`                                 | public                 | PLT-06   |
| `GET /registrations/slug-availability?slug=` | platform, public       | US-011.1 |
| `POST /registrations`                        | platform, public       | US-011.1 |
| `POST /registrations/verify-email`           | platform, public       | US-011.2 |
| `POST /registrations/resend-verification`    | platform, public       | US-011.2 |
| `GET /registrations/resubmission?token=`     | platform, public       | US-011.5 |
| `PUT /registrations/resubmission`            | platform, public       | US-011.5 |
| `GET /platform/registrations`                | platform, System Owner | US-011.3 |
| `GET /platform/registrations/{id}`           | platform, System Owner | US-011.3 |
| `POST /platform/registrations/{id}/approve`  | platform, System Owner | US-011.3 |
| `POST /platform/registrations/{id}/reject`   | platform, System Owner | US-011.4 |

## Screens introduced

| Screen                                    | Where                                | Story            |
| ----------------------------------------- | ------------------------------------ | ---------------- |
| Register your company                     | `<base>/register`                    | US-011.1         |
| Check your email                          | `<base>/register/check-email`        | US-011.1 / 011.2 |
| Email verified                            | `<base>/register/verify`             | US-011.2         |
| Resubmit your application                 | `<base>/register/resubmit`           | US-011.5         |
| Registration queue                        | `<base>/platform/registrations`      | US-011.3         |
| Registration detail with Approve / Reject | `<base>/platform/registrations/{id}` | US-011.3 / 011.4 |

A **Register your company** link is added to the base-domain login page.

## Definition of Done

- Every acceptance criterion in the seven specs passes.
- Unit tests for services; integration tests for each endpoint and for the queue consumer against the local runtime.
- The full journey (register → verify → approve → sign in on the new subdomain; register → reject → resubmit → approve) is checked in the browser in **both Arabic and English** at phone width.
- `npm run check` and `npm run build` pass; migrations apply cleanly to a fresh local D1.
- `03_DATABASE.md`, `04_API.md` and the Cloudflare resource notes (Resend secret, Turnstile keys, queue consumer) are updated.

## Implementation notes

### Refinements made during implementation (for acceptance)

| Item                        | Approved text                                            | As built                                                                                                                                                                         | Why                                                                          |
| --------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| US-011.1 "Check your email" | Shows the email address                                  | The address is passed in `sessionStorage`, not the URL. If it's missing (another tab, private mode), the page says "the address you entered" and asks for the address on resend. | Keeps the applicant's email out of browser history and server logs.          |
| US-011.1 Country list       | Saudi Arabia first, then the GCC, then all others (O-17) | Two groups in the select: "Gulf countries" in the agreed order, then "All countries" sorted by the translated name (`Intl.DisplayNames`, `Intl.Collator`).                       | The long list is easier to scan in either language.                          |
| US-011.1 Terms (O-14)       | Links to Terms of Service and Privacy Policy             | `/terms` and `/privacy` placeholder pages ("the final text will be published here before launch"), opened in a new tab.                                                          | The texts are still to come from the Product Owner; no dead links meanwhile. |
| US-011.3 Plan names         | Queue and detail show the plan                           | Plan names come from `GET /plans` in the reviewer's language; inactive plans fall back to the plan code.                                                                         | The review DTOs carry only `planCode`.                                       |
| US-011.5 Live slug check    | Same as US-011.1                                         | The applicant's own subdomain shows "Your current address" without calling the API (the public endpoint would report it as taken by their own application).                      | Correct feedback on an unchanged subdomain.                                  |

### Added beyond the specs

- Shared UI components `Select`, `Textarea` and `Checkbox` (`components/ui`); `ConfirmDialog` takes extra content (the rejection reason) and a disabled confirm state; `PublicPage` has a `wide` variant for the registration form; `PasswordChecklist` takes an optional title.
- After approve or reject, the detail page scrolls to the outcome; on submit errors, the registration form moves focus to the first invalid field or the summary at the top (phone screens).
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is validated with the other public settings and added to `apps/web/.env.example` and the CI workflow (test key).

### Defects found and fixed during the browser check

- **API: every real Turnstile check failed** (`BOT_CHECK_FAILED`). `TurnstileBotCheck` stored the global `fetch` as a property and called it as a method, which Workers reject ("Illegal invocation"); unit tests passed because they inject a fake `fetch`. The default is now wrapped. The same latent bug in `ResendEmailSender` was fixed before it could reach staging. A regression test (`test/integration/email.test.ts`, "default fetch") enforces the Workers rule and fails on the old code.
- **Web: Arabic page left-to-right after a language switch.** When a signed-in user switched language while the saved preference was still being applied, the page showed Arabic text with `dir="ltr"`. `applyLanguage` now also compares with the document's current language (Sprint 1 hook).
- Found in the self-review before acceptance: a network error on the verify page showed "link expired" (now an error with **Try again**); a malformed id in the console address showed "Some fields are invalid" (now "not found"); after a failed submit, focus could skip an earlier invalid field (now page order); the "Default language" field now follows the page language until the applicant picks one.
- Smaller fixes: the subdomain preview wrapped mid-word and showed `-your` in Arabic; the left-to-right time-zone select overlapped its arrow in Arabic; the rejection counter read "1000 / 4" in Arabic (now "4 من 1000"); slugs and emails in RTL cards aligned to the wrong edge; a taken subdomain repeated the same message three times.

### Known gaps

- **CI web build**: `.github/workflows/ci.yml` sets `NEXT_PUBLIC_API_BASE_URL` to an absolute URL, which `public-env.ts` rejects (it must be a same-origin path such as `/api/v1`). Pre-existing; not changed here.
- From the API side (unchanged): trials don't end until Sprint 4 (O-20); payment proof and the company logo move to Sprints 4 and 3 (O-11).

### Verification

- `npm run check` passes: formatting, lint (including no JSX literals, logical CSS only and matching translation keys), typecheck, shared 43 tests and API 125 tests. `npm run build` passes.
- Browser (local dev, 375 px, Arabic and English), with `EMAIL_PROVIDER=log` and the real Turnstile verification call using test keys:
  - English: register (validation messages, live subdomain check, Turnstile) → check email → resend → old link shows "expired" → new link verifies → System Owner queue (cards) → detail → approve with phone confirmation and a plan change → "Company created" with the sign-in link → sign in on `gulf-build-co.localhost:3000` with the password set at registration.
  - Arabic: register with an Arabic company name (taken `demo` subdomain flagged live) → Arabic emails → verify → reject (reason under 10 characters refused) → resubmit with the reason shown and email read-only → reused link shows "expired" → approve → sign in on `binaa-gulf.localhost:3000`.
  - English reject → resubmit with a taken subdomain (server `SLUG_UNAVAILABLE` shown on the field), new name, subdomain and optional new password → approve → sign in on `curl-works.localhost:3000` with the new password.
  - Data after the journeys (local D1): each approved company is `active` with its contact details, one `trial` subscription of exactly 14 days on the approved plan, a `company_administrator` with the application's language, and audit entries; every submission and resubmission emailed both seeded System Owners; all outbox rows `sent`. An email already in use got the same 202 answer, a `registration.already_exists` email and no application.
- Guards: the console on a company subdomain shows "You don't have access to this page"; `/register` on a company subdomain shows "Registration isn't available here".
