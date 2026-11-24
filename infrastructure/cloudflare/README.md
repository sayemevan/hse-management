# Cloudflare resources

Resource inventory for the stack in ADR-001. Nothing is provisioned yet; environments, the
base domain and data residency are open questions (Q-04, Q-36, F-01a).

| Binding             | Type          | Local name       | Used for                                                      |
| ------------------- | ------------- | ---------------- | ------------------------------------------------------------- |
| `DB`                | D1            | `hse-db`         | All business records                                          |
| `FILES`             | R2            | `hse-files`      | Attachments, photos, documents (metadata in D1)               |
| `CACHE`             | KV            | —                | Settings, temporary data such as the tenant lookup cache      |
| `JOBS`              | Queue         | `hse-jobs`       | Email sending (PLT-05); later notifications, images, reports  |
| `AUTH_RATE_LIMITER` | Rate limiting | namespace `1001` | 10 requests / minute / IP for sign-in and token refresh (T-7) |

The API Worker is also the **queue consumer** for `hse-jobs` (batches of up to 10, 5 s batch timeout, 5 retries with backoff). Each email message is sent through Resend and recorded in `email_outbox`.

Cron triggers (`triggers.crons` in `apps/api/wrangler.jsonc`):

- `0 3 * * *` (daily, 03:00 UTC): the daily jobs (see Sprint 4 settings): session token purge (US-010), deleted-file purge, registration housekeeping (O-15) and the subscription lifecycle.
- `*/15 * * * *` (every 15 minutes): re-publishes emails stuck in `queued` for more than 10 minutes; emails with a one-time link are marked failed instead (the applicant requests a new link).

## External services (Sprint 2)

| Service              | Setting                                                                                  | Where                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resend (email, D-33) | `RESEND_API_KEY` (**secret**), `EMAIL_PROVIDER=resend`, `EMAIL_FROM` (a verified sender) | API Worker. Verify the sending domain in Resend (SPF/DKIM DNS records). Locally `EMAIL_PROVIDER=log` writes emails, links included, to the API log instead. |
| Turnstile (T-11)     | `TURNSTILE_SECRET_KEY` (**secret**), `BOT_CHECK=turnstile`                               | API Worker. Create one widget per environment in the Cloudflare dashboard, with the base domain as an allowed hostname.                                     |
| Turnstile (T-11)     | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public)                                                | Web app build environment. Inlined at build time, so set it before `npm run build`.                                                                         |

Cloudflare's always-pass test keys are used locally and in CI: site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`. `BOT_CHECK=disabled` is accepted only in development and tests.

Also set `PLATFORM_URL` (the public base-domain URL used in email links) and review the registration values (`TRIAL_DAYS`, `REGISTRATION_*`) per environment.

## Sprint 3 settings

- `FILES` (R2): create one private bucket per environment. Nothing in it is public; files are served through the API (PLT-07). The daily cron also removes the bytes of files deleted more than 30 days ago.
- `INVITATION_TTL_DAYS` (7), `PASSWORD_RESET_TTL_MINUTES` (60), `PASSWORD_RESET_LIMIT_PER_HOUR` (3): plain vars in `wrangler.jsonc`.

## Sprint 4 settings

- The daily cron now runs the **job registry** (PLT-09): `sessions.purge`, `files.purge`, `registrations.maintenance`, `subscriptions.lifecycle`, each on its own, recorded in `job_run`. The lifecycle job records trial expiry, grace and read-only, and sends the subscription reminders (PLT-15).
- `GRACE_DAYS` (14, D-18) and `PENDING_PROOF_HOLD_DAYS` (5, O-32): plain vars.
- `BILLING_BANK_NAME`, `BILLING_BENEFICIARY`, `BILLING_IBAN`: the account shown for transfers (O-37). **Placeholders until the Product Owner supplies them (F-09)**; set real values before onboarding customers.

## Routing (T-4)

The API and the web app share every host. In each environment:

- wildcard DNS for `*.<base-domain>`;
- Workers routes `*.<base-domain>/api/*` and `<base-domain>/api/*` → `hse-api`;
- everything else → `hse-web`.

Set `BASE_DOMAIN`, and keep `TRUST_FORWARDED_HOST=false` outside local development (the API refuses `true` in production).

## Provisioning checklist (per environment)

1. `npx wrangler d1 create hse-db-<env>` and copy the id into `apps/api/wrangler.jsonc` under `env.<env>`.
2. `npx wrangler r2 bucket create hse-files-<env>`
3. `npx wrangler kv namespace create hse-cache-<env>`
4. `npx wrangler queues create hse-jobs-<env>`
5. Secrets: `npx wrangler secret put JWT_SECRET --env <env>`, then the same for `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY`.
6. Set `vars` for the environment (`APP_ENV`, `LOG_LEVEL`, `BASE_DOMAIN`, `PLATFORM_URL`, `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, `BOT_CHECK=turnstile`, session, lockout and registration values, …), and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for the web build.
7. Apply migrations: `npx wrangler d1 migrations apply DB --env <env> --remote`.
8. Create the first System Owner: `npm run bootstrap:system-owner --workspace @hse/api -- --env <env>` (PLT-04).

Bindings are **not inherited** by Wrangler environments, so each `env.<env>` block must declare all of them, including the rate limiter, the queue producer **and consumer**, and both cron triggers.
