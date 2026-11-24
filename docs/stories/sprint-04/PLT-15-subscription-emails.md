# PLT-15 — Subscription Emails

| Field    | Value                                                                 |
| -------- | --------------------------------------------------------------------- |
| Epic     | Platform / services                                                   |
| Priority | Must                                                                  |
| Status   | Approved                                                              |
| Sources  | D-18 ("with reminders"), D-29; PLT-05, PLT-09; T-12, T-26; O-35, O-37 |

## Business Goal

No company becomes read-only by surprise: its administrators are told well before every deadline, in their own language, with a direct link to pay.

## Description

The subscription emails, their timing and recipients. Date-based reminders are sent by the daily job through `ReminderService.sendOnce` (PLT-09); event emails (submitted, confirmed, rejected) are sent at once when the event happens.

## Actors

The system; Company Administrators and System Owners (recipients).

## Preconditions

PLT-05 (email), PLT-09 (reminders), PLT-10 (dates).

## Functional Requirements

The system shall send these emails (O-35):

| Template                         | When                                          | To                     | Reminder key (T-26)                                |
| -------------------------------- | --------------------------------------------- | ---------------------- | -------------------------------------------------- |
| `subscription.trial_ending`      | 7, 3 and 1 days before `trial_ends_at`        | Company Administrators | `sub:<id>:trial_ending:<days>:<trial_ends_at>`     |
| `subscription.trial_ended`       | when the trial ends unpaid (read-only starts) | Company Administrators | `sub:<id>:read_only:<trial_ends_at>`               |
| `subscription.renewal_due`       | 14, 7 and 1 days before `current_period_end`  | Company Administrators | `sub:<id>:renewal_due:<days>:<current_period_end>` |
| `subscription.grace_started`     | when grace starts                             | Company Administrators | `sub:<id>:grace_started:<current_period_end>`      |
| `subscription.grace_ending`      | 7 and 1 days before `grace_ends_at`           | Company Administrators | `sub:<id>:grace_ending:<days>:<grace_ends_at>`     |
| `subscription.read_only_started` | when grace ends unpaid                        | Company Administrators | `sub:<id>:read_only:<grace_ends_at>`               |
| `payment.submitted`              | on submission (PLT-13)                        | every System Owner     | — (event)                                          |
| `payment.confirmed`              | on confirmation (PLT-14)                      | Company Administrators | — (event)                                          |
| `payment.rejected`               | on rejection (PLT-14)                         | Company Administrators | — (event)                                          |

1. Send to every **active** user with the Company Administrator role, each in their own language (D-21); no administrator → log a warning.
2. Skip the date-based reminders that no longer apply: no "trial ending" or "renewal due" when a payment for the next period is already confirmed; no reminders while the company is `suspended`.
3. A day is counted in the company's time zone, so "1 day before" arrives on the day before the deadline there. A reminder whose day was missed (job down) is sent at the next run if the deadline hasn't passed yet; a missed one for a passed deadline is not sent.
4. Every reminder email contains: company name, the deadline in the company's date format, what happens next ("the workspace becomes read-only — your data is kept"), the bank details (O-37), and a button to the subscription page on the company's subdomain.
5. `payment.rejected` includes the reason and a **Submit again** button; `payment.confirmed` includes plan, cycle, amount confirmed and the new end date; `payment.submitted` links the System Owner to the payment detail on the base domain.
6. Templates in English and Arabic (HTML with `dir="rtl"` for Arabic, plus plain text, T-12), using the existing email layout.

## Validation Rules

None beyond the templates' typed data.

## Permission Rules

Not applicable (system sends). Links lead to pages that check permissions themselves.

## Database Impact

`reminder_log` rows (PLT-09) and `email_outbox` rows (PLT-05).

## API Requirements

None.

## UI Requirements

Email only. Subject lines, for example: "Your trial ends in 3 days — {company}", "Payment confirmed — {company} is active until {date}", "Action needed: {company} is now read-only".

## Error Handling

Sending failures are retried by the email service (PLT-05). A template error fails only that email, logged with the template name.

## Notifications

This spec is the notifications.

## Audit Requirements

None (the outbox is the record of what was sent).

## Acceptance Criteria

- A trial ending in 7, 3 and 1 days produces exactly one email per administrator on each of those days, in their language.
- Running the job twice on the same day sends nothing new.
- A confirmed renewal stops the remaining renewal reminders.
- Confirmed and rejected payments are emailed at once with the right details.

## Test Scenarios

- **Positive (fixed clock):** each template in English and Arabic; time-zone boundary for "1 day before" in Asia/Riyadh and UTC; two administrators with different languages.
- **Negative:** no administrators; job run twice; a reminder day missed and recovered; deadline already passed.

## Future Improvements

In-app notifications alongside email (Sprint 6); SMS reminders when an SMS provider is chosen (F-07); per-user opt-out for non-critical reminders (Sprint 19).
