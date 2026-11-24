# PLT-14 — Payment Review & Subscriptions Overview

| Field    | Value                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Epic     | Platform / administration                                                                     |
| Priority | Must                                                                                          |
| Status   | Approved                                                                                      |
| Sources  | D-07, D-19; US-011.3 / US-011.4 (same review pattern); PLT-10, PLT-13; T-14, T-28; O-33, O-34 |

## Business Goal

The System Owner can check a bank-transfer receipt and switch the company on in under a minute, and can see at a glance which companies are in trial, paid, in grace or read-only.

## Description

A payments queue on the platform console lists pending submissions. The detail shows the company, what it asked for, the amount, the transfer date and the receipt. **Confirm** (optionally adjusting the plan, cycle or amount received) activates or renews the subscription (PLT-10). **Reject** needs a reason and lets the company submit again. A subscriptions overview lists every company with its state and dates.

## Actors

System Owner.

## Preconditions

Signed in on the base domain with `platform.payments.review` / `platform.subscriptions.view` (temporary checker, T-14).

## User Flow

1. Open **Payments** on the console (badge with the pending count). Cards: company, plan and cycle, amount, submitted date.
2. Open one. View or download the receipt (PDF or image preview).
3. **Confirm**: check or change plan, cycle and amount received; see "Active from {start} to {end}" before saving. Or **Reject** with a reason (at least 10 characters).
4. Back to the queue; the company is emailed.
5. **Subscriptions**: filter by state; each card shows company, plan, state, end date and a link to its payments.

## Functional Requirements

The system shall:

1. List payments by status (default `pending`, oldest first) at `GET /platform/payments?status=`.
2. Return one payment with the company (name, subdomain, contact), the subscription's current state and dates, and the company's previous payments.
3. Serve the receipt at `GET /platform/payments/{id}/file` through the file service (T-28), `Content-Disposition: inline` for images and PDF, `private, no-store`.
4. **Confirm** (`POST /platform/payments/{id}/confirm` with optional `planCode`, `billingCycle`, `amountReceived`): in one batch, mark the payment `confirmed` with reviewer, time and the confirmed values; compute the period (PLT-10 FR-3); update the subscription and company; clear the tenant cache; queue the email.
5. **Reject** (`POST /platform/payments/{id}/reject` with `reason`): mark it `rejected` with reviewer, time and reason; end any pending-proof hold (PLT-10 FR-2); queue the email.
6. Refuse a review of a payment that isn't `pending` (`409 PAYMENT_ALREADY_REVIEWED`), so two System Owners can't both act on it.
7. List subscriptions at `GET /platform/subscriptions?state=` with company name, subdomain, plan, effective state, the relevant end date, and whether a payment is pending; sorted by the nearest deadline.
8. Show "Last checked: {time}" from the last `subscriptions.lifecycle` run (PLT-09).

## Validation Rules

- `reason`: 10–1000 characters (same as registration rejection, US-011.4).
- `planCode`: an active plan; `billingCycle`: `monthly`/`annual`; `amountReceived`: same rules as PLT-13.
- The confirmed plan must fit current usage (PLT-12 FR-9); if it doesn't, the System Owner sees which limit and can still confirm a larger plan.

## Permission Rules

- Payments: `platform.payments.review`. Subscriptions overview and jobs: `platform.subscriptions.view`. Both granted to `system_owner` by the temporary checker (T-14 extended).
- Not reachable on a company subdomain (platform context only).

## Database Impact

Updates `payment`, `subscription`, `company`; reads `file`. No new table.

## API Requirements

As listed in FR-1 to FR-7, standard envelope; list endpoints paginated (`?cursor=`, 25 per page).

## UI Requirements

- `<base>/platform/payments` (queue, detail) and `<base>/platform/subscriptions`, in the console navigation next to Registrations.
- Same card and detail layout as the registrations queue (Sprint 2); confirm and reject in dialogs; the period preview updates as plan or cycle change.
- Receipt: image shown fitted with a "Open full size" link; PDF opened in a new tab.
- Arabic and English, phone width first.

## Error Handling

`PAYMENT_ALREADY_REVIEWED`, `PLAN_NOT_AVAILABLE`, `PLAN_LIMIT_REACHED` (warning on a smaller plan), validation errors, `404` for an unknown id.

## Notifications

PLT-15: `payment.confirmed` (with the new end date) or `payment.rejected` (with the reason and a link to submit again) to every active Company Administrator of the company.

## Audit Requirements

`payment.confirmed` (with asked and confirmed plan, cycle, amount, period) and `payment.rejected` (with reason), plus the PLT-10 subscription entries. Actor: the System Owner.

## Acceptance Criteria

- The System Owner sees pending payments, opens the receipt and confirms one; the company becomes active (or stays in trial with a paid period queued) and the administrators are emailed.
- Rejecting needs a reason; the company sees it and can submit again.
- A payment can't be reviewed twice.
- The subscriptions overview filters by state and shows the right end date.

## Test Scenarios

- **Positive:** confirm during trial, while active (early renewal), in grace, in read-only; confirm with a changed plan and amount; reject; overview filters.
- **Negative:** review twice (two sessions); reject without a reason; company user calling the platform routes; receipt of a withdrawn payment.

## Future Improvements

Manual trial extension, credits and suspension (Sprint 19, O-38); payment export for accounting and invoicing (F-10).
