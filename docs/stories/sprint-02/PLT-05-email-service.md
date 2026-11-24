# PLT-05 — Email Service

| Field    | Value                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform services (Epic 16 dependency)                                                                                                                           |
| Priority | Must                                                                                                                                                             |
| Status   | Approved                                                                                                                                                         |
| Sources  | Master Rules §6 (one notification service), MASTER_RULES_03 (notifications); Product Book Doc 01 §13, Doc 02 §3 (Queues), Doc 31; D-10, D-33, ADR-002; T-9, T-12 |

## Business Goal

Send every platform email (verification, approval, rejection, and later invitations, resets and reminders) through one reliable service. Modules never talk to an email provider directly.

## Description

A module asks the email service to send a named **template** to a recipient in a language. The service records the request in an outbox and puts it on the `JOBS` queue. A queue consumer renders the template and sends it through Resend. Failures are retried automatically, and every attempt is traceable.

## Actors

Every module (as a caller); the System Owner (as a reader of delivery status, in a later sprint).

## Preconditions

- Resend API key stored as a Worker secret (`RESEND_API_KEY`) in deployed environments.
- Sending domain verified at Resend (SPF/DKIM). This needs the base domain (D-26), so until then only the log sender is used.

## Functional Requirements

The service shall:

1. Expose one method, `enqueue({ template, to, language, data })`. It returns a statement for the caller's `UnitOfWork`, so the email is recorded together with the business change that caused it. If the change fails, no email is sent.
2. Write an `email_outbox` row (status `queued`) and publish `{ outboxId }` to `JOBS` after the batch commits.
3. In the queue consumer: render the template, send it, then mark the row `sent` (storing the provider message id) or `failed`. Queue retries handle temporary errors, up to 5 attempts with increasing delay; after that the row is marked `failed` and an error is logged.
4. Make sending **idempotent**: a message already marked `sent` is never sent twice, even if the queue redelivers it.
5. Recover from a lost queue publish: a scheduled job (every 15 minutes) re-publishes rows still `queued` after 10 minutes. Because of FR-4 this can never cause a duplicate. Token-carrying emails can't be re-published (the token isn't stored), so they are marked `failed`, and the user can request a new link.
6. Choose the sender from configuration: `EMAIL_PROVIDER=resend` (deployed) or `log` (development and tests, which writes the rendered email to the log instead of sending it).
7. Provide templates in **English and Arabic** (T-12): HTML with `lang` and `dir`, plus a plain-text version. The subject is translated too. Values inserted into templates are HTML-escaped.
8. Sprint 2 templates: `registration.verify_email`, `registration.submitted` (to the applicant), `registration.new_for_review` (to System Owners), `registration.approved`, `registration.rejected`.

## Validation Rules

- `to` must be a valid email address; `template` must be a registered template name; `language` must be `en` or `ar`.
- The data passed to each template is validated with that template's Zod schema.

## Permission Rules

Server code only. There is no public API for sending email.

## Database Impact

New table `email_outbox`:

| Column                  | Type           | Notes                                          |
| ----------------------- | -------------- | ---------------------------------------------- |
| `id`                    | TEXT (UUID)    | PK                                             |
| `template`              | TEXT           | template name                                  |
| `recipient`             | TEXT           | email address                                  |
| `language`              | TEXT           | `en` / `ar`                                    |
| `data`                  | TEXT (JSON)    | template values; never passwords or raw tokens |
| `status`                | TEXT           | `queued`, `sent`, `failed`                     |
| `attempts`              | INTEGER        |                                                |
| `provider_message_id`   | TEXT, nullable |                                                |
| `last_error`            | TEXT, nullable | short, non-sensitive                           |
| `company_id`            | TEXT, nullable | for tenant-scoped reporting                    |
| `created_at`, `sent_at` | INTEGER        | UTC ms                                         |

**Links with tokens.** Only the token's hash may be stored (T-10). So the raw token for a verification or resubmission link travels only in the queue message (`{ outboxId, secrets }`) and is inserted into the email at send time. If a message fails permanently, the user asks for a new link (for example "Resend verification email", US-011.2).

## API Requirements

None.

## UI Requirements

None.

## Error Handling

- A failure to enqueue makes the business change fail too (same batch).
- Provider errors are logged without the email body. 4xx errors other than rate limiting are not retried.

## Notifications

This is the email channel itself.

## Audit Requirements

Delivery is tracked in `email_outbox`, not in the audit log. The business action that caused the email is audited by its own module.

## Acceptance Criteria

- Enqueuing in a batch that fails sends nothing.
- A queued email is sent once, even when the message is delivered twice.
- With `EMAIL_PROVIDER=log`, the rendered subject and text appear in the log and the row is marked `sent`.
- Arabic emails have `dir="rtl"` and an Arabic subject; English emails `dir="ltr"`.
- A temporary provider error is retried; a permanent one marks the row `failed`.

## Test Scenarios

- **Positive:** each Sprint 2 template in both languages renders and validates.
- **Negative:** unknown template; invalid data; provider 500 then success (retried); provider 422 (not retried); duplicate delivery.
- **Security:** template data containing `<script>` is escaped.

## Future Improvements

Delivery and bounce webhooks; per-user notification preferences (Doc 08 §4); in-app notification channel (Sprint 6).
