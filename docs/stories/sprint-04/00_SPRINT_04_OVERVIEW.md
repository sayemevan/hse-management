# Sprint 4 — Subscription Lifecycle

**Status: DONE — accepted by the Product Owner on 2026-11-11 (D-42).** Approved by the Product Owner on 2026-11-11 (D-40), including technical decisions T-22 to T-29 and the proposed answers to open points O-31 to O-42 (D-41).

## Goal

A company's subscription runs on its own from trial to paid to lapsed and back. The Company Administrator pays by bank transfer and uploads the receipt; the System Owner confirms it. Reminders go out before every deadline. An unpaid company becomes read-only (view only, data kept), and plan limits on users and storage are enforced. After this sprint, real customers can be onboarded (O-20, D-35).

## Scope

| ID     | Title                                    | Type             | Spec                                         |
| ------ | ---------------------------------------- | ---------------- | -------------------------------------------- |
| PLT-09 | Scheduled jobs & reminder core           | Platform enabler | [PLT-09](PLT-09-scheduled-jobs-reminders.md) |
| PLT-10 | Subscription lifecycle                   | Platform enabler | [PLT-10](PLT-10-subscription-lifecycle.md)   |
| PLT-11 | Read-only mode                           | Platform enabler | [PLT-11](PLT-11-read-only-mode.md)           |
| PLT-12 | Plan-limit enforcement                   | Platform enabler | [PLT-12](PLT-12-plan-limits.md)              |
| PLT-13 | Subscription page & payment-proof upload | Platform story   | [PLT-13](PLT-13-payment-proof-upload.md)     |
| PLT-14 | Payment review & subscriptions overview  | Platform story   | [PLT-14](PLT-14-payment-review.md)           |
| PLT-15 | Subscription emails                      | Platform story   | [PLT-15](PLT-15-subscription-emails.md)      |

Seven items, inside the Doc 14 size range (5–10). The Doc 14 backlog has no subscription stories (Platform → "Manage subscriptions", "Billing (Future)", Doc 06 §2), so every item uses a `PLT` ID (see O-42).

**Out of scope:**

- Payment gateway, card payments, automatic bank reconciliation (D-07: manual bank transfer in Phase 1).
- Issuing VAT tax invoices (see O-40 and new follow-up **F-10**).
- Prices: plan prices stay "Price on request" until F-02b; the applicant enters the amount they transferred.
- Proration, coupons, add-ons, refunds.
- Project limit _checks at creation_ need projects (Sprint 5). PLT-12 provides the check, and Sprint 5 calls it.
- Exports: none exist yet. PLT-11 keeps a route for them open in read-only mode, ready for Sprints 17–18.
- Suspending a company by hand, extending a trial, editing plans and prices (Administration, Sprint 19), unless O-38 says otherwise.
- In-app notifications (Sprint 6). This sprint uses email and an in-app banner.

## Decisions applied

D-06 and D-29 (live after approval, trial before payment), D-07 (bank transfer, System Owner confirms), D-17 and D-27 (plans and limits as data), D-18 (14-day grace with reminders, then read-only, data never deleted), D-28 (storage per plan), D-30 (unpaid trial → read-only), D-33 (Resend), O-11 (payment proof in this sprint), O-13 (billing cycle chosen at payment), O-20 (no real customer before this sprint), T-9 (emails go through the outbox and queue), T-13 (plans are seeded data), T-18 (one file service), T-19 (storage is already counted), T-20 (temporary company permissions). See [PO_DECISIONS.md](../../architecture/PO_DECISIONS.md).

## Technical decisions (proposed)

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                              | Why                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-22 | The subscription's **access state is computed from its dates** (`trial_ends_at`, `current_period_end`, grace days) and the clock on every request, not only from the stored `status`. The daily job then **records** the change (status, company status, audit, emails).                                                                                              | A company becomes read-only at the exact moment its time runs out, even though the job runs once a day. The stored status can never grant more than the dates allow.  |
| T-23 | `company.status` (which already has a `read_only` value) is **kept in step** with the subscription in the same database batch: `active` while `trial`, `active` or `grace`; `read_only` when `read_only`. The tenant cache is cleared on every change.                                                                                                                | Tenant resolution already loads and caches the company status, so every module sees read-only mode without asking the subscription module.                            |
| T-24 | Read-only mode is enforced by **one middleware** on company routes that **refuses every write (POST, PUT, PATCH, DELETE) by default**. Routes that must keep working are listed explicitly: sign-in and sessions, own profile and password, the subscription page and payment proof, and (later) exports.                                                             | Deny by default: a new module's write route is blocked automatically and can't be forgotten. The allow-list is short and reviewed.                                    |
| T-25 | Scheduled work runs through a small **job registry**: each daily job is a named function, run in its own `try/catch`, timed and logged, and recorded in a `job_run` table. The existing session, file and registration housekeeping move into it.                                                                                                                     | One failing job never stops the others; the System Owner (and we) can see when each job last ran and whether it worked.                                               |
| T-26 | Reminders are sent at most once, using a **`reminder_log` table with a unique key** (for example `subscription:<id>:trial_ending:7:<trial_ends_at>`). The job inserts the key and enqueues the email in the same batch; a rerun finds the key and skips it.                                                                                                           | Running the job twice, or late, never sends a duplicate email; the date in the key means a new period gets its own reminders.                                         |
| T-27 | Payment proofs are a new **`payment` table** (one row per submission: plan, cycle, amount, transfer date, reference, file, status `pending` / `confirmed` / `rejected`, reviewer and reason). The receipt is stored through PLT-07 in a new private category `payment_proof`.                                                                                         | Every submission and decision is kept for the record; the file service already checks type, size and tenant.                                                          |
| T-28 | The System Owner opens a company's receipt through a **platform route** (`GET /platform/payments/{id}/file`), guarded by `platform.payments.review`. Company users use the normal `GET /files/{id}`. Both go through the file service.                                                                                                                                | The existing download route only works inside the company's own subdomain; the System Owner works on the base domain.                                                 |
| T-29 | Plan limits are checked by **one `PlanLimitService`** in the subscription module: `assertCanAdd(companyId, 'users' \| 'projects' \| 'storage', amount)`. The Sprint 3 seat check (O-26) and the file service's upload both call it; Sprint 5 calls it before creating a project. The temporary permission checkers (T-14, T-20) get the new permissions listed below. | One place knows the limits; modules don't read the plan tables (module boundaries, Master Rules §3). The usage counters stay in the modules that own the data (T-19). |

New permissions (temporary checkers until Sprint 5): company scope `subscription.view`, `subscription.pay` (Company Administrator); platform scope `platform.payments.review`, `platform.subscriptions.view` (System Owner).

## Open points for Product Owner approval

| ID   | Question                                                                                              | Proposed answer                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O-31 | Does an unpaid trial get the 14-day grace period too, or does it go read-only straight away?          | **Straight to read-only** when the trial ends (D-30). The trial is already the free period, and it gets its own reminders (O-35). Grace applies to a paid period that wasn't renewed (D-18).                                                                                                     |
| O-32 | A receipt is uploaded but not yet reviewed when the trial or the period ends. What happens?           | **The company stays writable while the proof is pending** (status unchanged, the banner says "payment under review"), for at most **5 days** after the deadline. If the proof is rejected, or 5 days pass, the normal rule applies at once.                                                      |
| O-33 | When does a paid period start?                                                                        | **Paying during the trial:** the period starts when the trial ends (unused trial days aren't lost). **Renewing early:** the new period starts when the current one ends. **Paying in grace or read-only:** from the confirmation date. Monthly = 1 calendar month, annual = 12 calendar months.  |
| O-34 | Can the company change plan or billing cycle when it pays?                                            | **Yes.** The Company Administrator picks the plan and cycle on each payment. A smaller plan is accepted only if current users and storage fit its limits (the form says which limit is over). The new plan applies from the new period's start; the System Owner can change it while confirming. |
| O-35 | Which reminders, and to whom?                                                                         | **To every active Company Administrator, in their own language.** Trial ending: 7, 3 and 1 days before. Renewal due: 14, 7 and 1 days before. Grace: when it starts, then 7 and 1 days before read-only. Read-only: on the day. Payment confirmed or rejected: at once.                          |
| O-36 | What can users still do in read-only mode?                                                            | **View everything; sign in and out; manage their own profile, password and sessions; Company Administrators can open the subscription page and upload a receipt.** No new or changed records, no invitations, no settings or logo changes. Export (when it exists) stays allowed (D-18).         |
| O-37 | Where do the bank details shown for the transfer come from?                                           | **The Product Owner supplies them** (bank name, beneficiary name, IBAN; new follow-up **F-09**). They are stored as platform configuration, shown on the subscription page and in the renewal emails. Placeholders are used until then.                                                          |
| O-38 | Can the System Owner extend a trial or grant extra time by hand?                                      | **Not in this sprint** (Administration, Sprint 19). Meanwhile the System Owner can confirm a payment, which ends read-only mode at once.                                                                                                                                                         |
| O-39 | Receipt file rules?                                                                                   | **PDF, PNG, JPEG or WebP, up to 10 MB**, one file per submission. One pending submission per company at a time; it can be withdrawn and replaced while pending.                                                                                                                                  |
| O-40 | Does the platform issue VAT invoices?                                                                 | **Not in this sprint.** Saudi e-invoicing (ZATCA) applies to the platform as the seller, and the PO must decide how invoices are issued (accounting system or in-app; new follow-up **F-10**). The platform records each confirmed payment with its amount so invoices can be issued from it.    |
| O-41 | What happens to users and storage over the limit after moving to a smaller plan or if limits change?  | **Nothing is removed or blocked for existing data.** Only adding more is refused (new invitations, new uploads) until usage is back under the limit or the plan is upgraded. The subscription page shows the overage.                                                                            |
| O-42 | Story IDs: is `PLT-09`…`PLT-15` acceptable for these items, since Doc 14 has no subscription stories? | **Yes.** If the PO wants backlog IDs for them, they can be renumbered under Epic 02 when Q-28 is answered.                                                                                                                                                                                       |

## Data model introduced

| Table                     | Purpose                                                                                             | Spec           |
| ------------------------- | --------------------------------------------------------------------------------------------------- | -------------- |
| `job_run`                 | One row per scheduled job run: name, start, end, outcome, counts, error                             | PLT-09         |
| `reminder_log`            | One row per reminder already sent, with a unique key                                                | PLT-09         |
| `payment`                 | Each payment-proof submission and its review                                                        | PLT-13, PLT-14 |
| `subscription` (extended) | Adds `billing_cycle`, `current_period_start`, `grace_ends_at`, `read_only_since`, `pending_plan_id` | PLT-10         |
| `file` (category)         | New category `payment_proof` (private)                                                              | PLT-13         |

## API introduced

All under `/api/v1`, standard envelope.

| Method & path                          | Context                                  | Story         |
| -------------------------------------- | ---------------------------------------- | ------------- |
| `GET /subscription`                    | company, signed in (`subscription.view`) | PLT-13        |
| `GET /subscription/payments`           | company, Company Administrator           | PLT-13        |
| `POST /subscription/payments`          | company, Company Administrator           | PLT-13        |
| `DELETE /subscription/payments/{id}`   | company, Company Administrator           | PLT-13        |
| `GET /platform/payments?status=`       | platform, System Owner                   | PLT-14        |
| `GET /platform/payments/{id}`          | platform, System Owner                   | PLT-14        |
| `GET /platform/payments/{id}/file`     | platform, System Owner                   | PLT-14 (T-28) |
| `POST /platform/payments/{id}/confirm` | platform, System Owner                   | PLT-14        |
| `POST /platform/payments/{id}/reject`  | platform, System Owner                   | PLT-14        |
| `GET /platform/subscriptions?status=`  | platform, System Owner                   | PLT-14        |
| `GET /platform/jobs`                   | platform, System Owner                   | PLT-09        |
| `GET /tenant` (extended)               | company, public                          | PLT-11        |

Every company write route returns `403 SUBSCRIPTION_READ_ONLY` in read-only mode unless it is on the PLT-11 allow-list. Invitations and uploads can return `409 PLAN_LIMIT_REACHED` (PLT-12).

## Screens introduced

| Screen                                                      | Where                           | Story  |
| ----------------------------------------------------------- | ------------------------------- | ------ |
| Subscription (status, usage, pay)                           | `<slug>/settings/subscription`  | PLT-13 |
| Subscription banner (trial, grace, read-only, under review) | app header, every company page  | PLT-11 |
| Payments queue and detail                                   | `<base>/platform/payments`      | PLT-14 |
| Subscriptions overview                                      | `<base>/platform/subscriptions` | PLT-14 |

## Definition of Done

- Every acceptance criterion in the seven specs passes.
- Unit tests for the lifecycle rules with a fixed clock (every transition and boundary, including month ends and 29 February); integration tests for each endpoint against the local runtime, including a forged receipt file type and every write route refused in read-only mode.
- The daily job run twice in a row sends no duplicate email.
- Browser check in **Arabic and English** at phone width: trial banner → upload receipt → System Owner confirms → active; a company moved past its dates (seeded clock / dev data) shows grace, then read-only, refuses an invitation, and becomes writable again after a confirmed payment.
- `npm run check` and `npm run build` pass; migrations apply cleanly to a fresh local D1 and on top of the Sprint 3 data (existing trial subscriptions keep their dates).
- `03_DATABASE.md`, `04_API.md` and the Cloudflare notes (cron triggers, new config values) are updated.

## Implementation notes

### Refinements made during implementation (for acceptance)

| Item                         | Approved text                                 | As built                                                                                                                                                                                        | Why                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-24 allow-list marker       | A marker set where each route is defined      | One reviewed allow-list (`READ_ONLY_ALLOWED_WRITES` in the billing module) plus a unit test that lists every company write route and fails when one is neither blocked on purpose nor allowed.  | Hono runs app-level middleware before route-level markers, so a per-route marker can't be read in time. The test gives the same "reviewed choice".                                      |
| Module placement             | Payments in the subscription module           | Data and rules (plans, subscriptions, `payment`, lifecycle, limits) in `subscription`; routes and workflows in a new `billing` module.                                                          | Identity depends on subscription (seat limit), and the routes need identity's sign-in and permissions; a separate module avoids a circular import (as `company-admin` did in Sprint 3). |
| PLT-12 FR-7 alias            | `PLAN_USER_LIMIT_REACHED` kept for one sprint | Only `PLAN_LIMIT_REACHED` is sent; the code stays in the shared list.                                                                                                                           | The web app switched in the same sprint, so nothing reads the old code.                                                                                                                 |
| PLT-12 counts                | Counts from the owning modules                | Users and storage are counted; projects are 0 until Sprint 5.                                                                                                                                   | No projects exist yet.                                                                                                                                                                  |
| PLT-15 FR-4 dates            | Deadline in the company's date format         | Long dates in the company's time zone ("25 November 2026"), like the other emails.                                                                                                              | Unambiguous in both languages; the email layout has no settings access.                                                                                                                 |
| PLT-15 FR-3 missed reminders | A missed reminder is sent at the next run     | The most urgent reached threshold is sent, so a missed "7 days" becomes the "3 days" one.                                                                                                       | One email per window, never two on the same day.                                                                                                                                        |
| PLT-10 FR-3 period preview   | —                                             | The period arithmetic lives in the shared package; the System Owner's confirm form shows the exact period the API will record.                                                                  | One rule, no copy in the web app.                                                                                                                                                       |
| PLT-14 FR-6 double review    | Refuse a second review                        | The payment update writes NULL into a NOT NULL column when the payment isn't pending, so the whole batch (period, emails, audit) fails and the second reviewer gets `PAYMENT_ALREADY_REVIEWED`. | D1 batches can't branch; this makes the check atomic.                                                                                                                                   |
| PLT-14 UI                    | Same layout as the registrations queue        | Cards at every width (no table).                                                                                                                                                                | Same information; fewer columns than registrations.                                                                                                                                     |
| US-015 account summary       | Stored subscription status                    | The effective state (T-22) for every user, with the plan and end date (PLT-13 FR-10).                                                                                                           | The stored status lags until the daily job.                                                                                                                                             |
| PLT-09 job history           | —                                             | `job_run` uses wall time even for a `--now` development run.                                                                                                                                    | Found in the browser check: a simulated run showed as "last checked" in the future.                                                                                                     |
| PLT-10 `read_only_since`     | Set when read-only starts                     | The deadline itself (trial end, or period end + grace), not the time the job noticed.                                                                                                           | Found in the browser check.                                                                                                                                                             |

### Added beyond the specs

- `npm run job:run --workspace @hse/api -- <name> [--now <ISO>]` delivers the emails a job queued to the log, so reminders can be tried locally.
- The dev seed gives both demo companies a 14-day Basic trial (closes the Sprint 3 gap "plan Not set").
- `apiBlob` / `authorizedBlob` in the web app for authenticated downloads (the receipt).
- Users page: "{used} of {limit} users", and Invite disabled at the limit or in read-only mode. Company profile, preferences and logo controls are disabled in read-only mode with the reason (PLT-11 FR-7).

### Known gaps

- **Bank details are placeholders** until the Product Owner supplies them (F-09). **VAT invoices** are not issued (F-10).
- Projects don't count yet (Sprint 5 calls `PlanLimitService` before creating a project).
- The real cron trigger was not fired in `wrangler dev`; the jobs were run through `job:run` and the integration tests (same code path).
- Two payments confirmed during the same trial: the second period stacks after the first, but a plan change on the first starts with the second period's start.
- CI web build: `NEXT_PUBLIC_API_BASE_URL` in `.github/workflows/ci.yml` is still an absolute URL (pre-existing).
- In-app notifications for these events wait for Sprint 6; email and the banner only.

### Verification

- `npm run check` passes: formatting, lint (incl. translation keys and logical CSS), typecheck, shared 43 tests and API 179 tests (25 new: lifecycle rules and the read-only route review 11, subscription integration 14). `npm run build` passes.
- Migration `0005` applied to the existing local D1 with Sprint 3 data; existing trials kept their dates.
- Browser (local dev, 375 px), `EMAIL_PROVIDER=log`:
  - Arabic, demo Company Administrator: subscription page right-to-left (plan, trial end, usage bars, bank details with the IBAN left-to-right) → empty submit shows the amount and receipt errors → annual payment with a PDF receipt → "under review" card, history entry. Both System Owners emailed in English.
  - English, System Owner: payments queue (1 waiting) → detail with the receipt loaded → period preview "25 Nov 2026 – 25 Nov 2027" (starts at trial end, O-33) → confirm → status Confirmed, paid period shown; the administrator emailed in Arabic.
  - `job:run --now 2026-11-22`: the four unpaid trials emailed "ends in 3 days" in each administrator's language, demo skipped (next period paid); run again → nothing sent.
  - Arabic demo trial moved into the past → job → read-only, Arabic "now read-only" email; users page shows the red banner with "Upload payment proof", Invite disabled with the reason → payment submitted from read-only (banner "under review") → System Owner confirms from the subscriptions overview link → Invite enabled, banner gone.
- Not checked in the browser: grace (covered by integration tests), the English company-side subscription page and the Arabic platform screens (translations checked by the i18n script), and withdrawing a payment (integration test).
