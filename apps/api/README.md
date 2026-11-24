# @hse/api

Hono API on Cloudflare Workers, organised as a modular monolith (ADR-001).

```bash
cp .dev.vars.example .dev.vars   # then set JWT_SECRET (or run `npm run setup` at the repo root)
npm run db:migrate:local         # create the local D1 tables
npm run db:seed:dev              # optional: sample companies and users (local only)
npm run dev                      # http://127.0.0.1:8787/api/v1/health
```

Local email uses `EMAIL_PROVIDER=log`: every email, including verification and resubmission links, is written to the API log instead of being sent. `BOT_CHECK=turnstile` with Cloudflare's always-pass test secret (in `.dev.vars.example`) runs the real verification call; the web app uses the matching test site key (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `apps/web/.env.example`). Set `EMAIL_PROVIDER=resend` plus `RESEND_API_KEY` in `.dev.vars` to send real email.

| Variable                                                                      | Purpose                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PLATFORM_URL`                                                                | Public base-domain URL used in email links                                                 |
| `EMAIL_PROVIDER` (`log` or `resend`), `EMAIL_FROM`, `RESEND_API_KEY` (secret) | Email sending (PLT-05)                                                                     |
| `BOT_CHECK` (`turnstile` or `disabled`), `TURNSTILE_SECRET_KEY` (secret)      | Bot check on the public registration form (T-11); `disabled` only in development and tests |
| `TRIAL_DAYS`                                                                  | Trial length on approval (D-29)                                                            |
| `REGISTRATION_VERIFY_TTL_HOURS`, `REGISTRATION_RESUBMIT_TTL_DAYS`             | Link lifetimes (24 hours, 30 days)                                                         |
| `REGISTRATION_UNVERIFIED_RETENTION_DAYS`                                      | Unverified applications are deleted after this (7 days)                                    |
| `REGISTRATION_RESEND_LIMIT_PER_HOUR`                                          | Verification emails per address per hour (3)                                               |
| `INVITATION_TTL_DAYS`                                                         | Days an invitation link works (7, O-21)                                                    |
| `PASSWORD_RESET_TTL_MINUTES`                                                  | Minutes a password-reset link works (60, O-22)                                             |
| `PASSWORD_RESET_LIMIT_PER_HOUR`                                               | Reset emails per account per hour (3)                                                      |
| `GRACE_DAYS`, `PENDING_PROOF_HOLD_DAYS`                                       | Grace after an unpaid period (14, D-18); hold while a proof is reviewed (5, O-32)          |
| `BILLING_BANK_NAME`, `BILLING_BENEFICIARY`, `BILLING_IBAN`                    | Bank account shown for transfers (O-37); placeholders until F-09                           |

Open the app through the web dev server (`npm run dev:web` at the root) on a company subdomain, e.g. `http://demo.localhost:3000`. The web server proxies `/api/*` here.

| Script                                                        | Purpose                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `dev`                                                         | Local Worker with emulated D1 / R2 / KV / Queues / rate limiter (Wrangler + Miniflare)  |
| `build`                                                       | Bundle check (`wrangler deploy --dry-run`) into `dist/`                                 |
| `typecheck`, `test`                                           | TypeScript; Vitest (unit + integration against an in-memory local D1)                   |
| `db:generate`                                                 | Generate SQL migrations from the `*.schema.ts` files                                    |
| `db:migrate:local`                                            | Apply migrations to the local D1                                                        |
| `db:seed:dev`                                                 | Local sample data; password in `scripts/seed-dev.ts`                                    |
| `job:run -- <name> [--now <ISO date>]`                        | Run one daily job on the local data, optionally as of another time (PLT-09)             |
| `bootstrap:system-owner -- --env <local\|staging\|…> [--add]` | Create the first System Owner (PLT-04). The password is typed hidden or piped on stdin. |

## Layout

| Path                          | Responsibility                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/config`                  | Env schema (Zod) and typed `AppConfig`; fails fast on invalid config                                   |
| `src/core/logging`            | Structured JSON logger with secret redaction                                                           |
| `src/core/errors`             | `AppError` hierarchy and the global error handler (no internals leak)                                  |
| `src/core/http`               | Response envelope, `validate()`, request metadata and host                                             |
| `src/core/auth`               | Password hasher, JWT token service, `authenticate(validator)`, `requirePermission()` (deny by default) |
| `src/core/middleware`         | Request id, request context, logging, security headers, CORS, same-origin guard, rate limiting         |
| `src/database`                | Drizzle client, shared column helpers, `UnitOfWork` (atomic D1 batch)                                  |
| `src/platform/audit-log`      | Immutable audit log service (PLT-01)                                                                   |
| `src/modules/company`         | Tenant resolution from subdomain, `GET /tenant` (PLT-02)                                               |
| `src/modules/identity`        | Sign-in, refresh, sign-out, sessions, password change (US-001/004/005/010)                             |
| `src/modules/registration`    | Company registration, verification, review queue, approve / reject, resubmit (US-011.1–011.5)          |
| `src/modules/subscription`    | Plans, subscriptions, lifecycle rules, payments data, plan limits (PLT-06, PLT-10, PLT-12)             |
| `src/modules/billing`         | Subscription page and payments, System Owner review, read-only guard, lifecycle job (Sprint 4)         |
| `src/platform/email`          | `EmailService` (enqueue), outbox, templates (en/ar), Resend and log senders, queue consumer (PLT-05)   |
| `src/platform/one-time-token` | Hashed single-use tokens (T-10)                                                                        |
| `src/platform/bot-check`      | Cloudflare Turnstile verification (T-11)                                                               |
| `src/platform/jobs`           | Queue messages, the daily job runner and `job_run` history (PLT-09)                                    |
| `src/platform/reminders`      | Send-once reminders keyed in `reminder_log` (PLT-09)                                                   |
| `src/routes`                  | `/api/v1` composition and the health probe                                                             |
| `scripts`                     | Operator commands (bootstrap, dev seed), run with `tsx`                                                |
| `migrations`                  | Drizzle-generated SQL plus custom SQL (audit triggers)                                                 |
