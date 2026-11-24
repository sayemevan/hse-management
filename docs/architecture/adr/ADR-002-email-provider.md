# ADR-002 — Email Provider

| Field   | Value                      |
| ------- | -------------------------- |
| Status  | **Accepted**               |
| Date    | 2026-11-11                 |
| Decider | Product Owner (D-33)       |
| Extends | ADR-001 (technology stack) |

## Context

Email is in Phase 1 (D-10): invitations, password reset, registration verification, approval and rejection notices, and reminders. D-10 asked for Cloudflare's email sending "if it is free".

As of November 2026, Cloudflare's official pricing page says outbound sending to arbitrary recipients needs the **Workers Paid** plan ($5/month). That plan includes 3,000 emails a month, then $0.35 per 1,000. The product is in public beta. So it isn't free.

## Decision

Use **Resend** for outbound email in Phase 1. Its free tier is 3,000 emails a month, with a limit of 100 a day.

All sending goes through one platform **email service** interface (Master Rules §6: one notification service). Modules never call Resend directly, so the provider can be swapped (for example to Cloudflare Email or Amazon SES) without changing any module. Sending runs from the `JOBS` queue, not inside user requests.

## Consequences

| Consequence                                                                              | Mitigation                                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A new vendor account, API key (Worker secret) and sending-domain DNS records (SPF, DKIM) | Set up when the base domain exists (D-26); local development uses a test key or a log-only sender |
| The free tier allows 100 emails a day; reminders and notifications will outgrow it       | Watch volume; move to a paid Resend plan or switch providers behind the same interface            |
| Personal data (email addresses) is processed outside Cloudflare                          | Check against the data-residency question (Q-04) before production                                |

## Related note

The production API almost certainly needs the **Workers Paid** plan anyway. Password hashing at 100,000 PBKDF2 iterations (ADR-001) uses more processing time per request than the free plan allows. Budget for it in every deployed environment.
