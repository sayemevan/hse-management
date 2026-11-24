# PLT-13 — Subscription Page & Payment-Proof Upload

| Field    | Value                                                                             |
| -------- | --------------------------------------------------------------------------------- |
| Epic     | Platform / tenancy                                                                |
| Priority | Must                                                                              |
| Status   | Approved                                                                          |
| Sources  | D-07, D-19, D-29; O-11, O-13; PLT-07, PLT-10, PLT-12; T-27; O-32–O-34, O-37, O-39 |

## Business Goal

The Company Administrator can see where the subscription stands and pay — by bank transfer, with a receipt — in a couple of minutes, from a phone, before or after the deadline.

## Description

A subscription page shows the plan, state, key dates, usage against the limits, the bank details for the transfer and the payment history. The administrator submits a payment: plan, billing cycle, amount transferred, transfer date, optional reference, and the receipt file. The System Owner reviews it (PLT-14).

## Actors

Company Administrator (pays); every company user (sees the summary on the company information page, US-015).

## Preconditions

Signed in on the company's subdomain; `subscription.pay` to submit.

## User Flow

1. Open **Settings → Subscription** (or follow the banner or an email).
2. See plan, state ("Trial — ends 25 Nov 2026"), usage ("12 of 25 users", "0.4 of 5 GB"), and the bank details.
3. Select **Submit payment**. Choose the plan and Monthly / Annual; enter the amount (SAR) and the transfer date; add a reference (optional); attach the receipt.
4. Submit. The page shows "Payment under review" with the submission, and a **Withdraw** button while it is pending.
5. After review: "Confirmed — active until {date}" or "Rejected: {reason}" with **Submit again**.

## Functional Requirements

The system shall:

1. Return the subscription summary at `GET /subscription`: plan, state, dates (PLT-10 FR-7), usage and limits (PLT-12), bank details (O-37), and the pending payment if any.
2. Accept a payment at `POST /subscription/payments` (`multipart/form-data`): `planCode`, `billingCycle`, `amount` (SAR, up to 2 decimals), `transferredOn` (date), `reference` (optional), `file`.
3. Store the receipt through PLT-07 in category `payment_proof` (PDF, PNG, JPEG, WebP; 10 MB; private, `Cache-Control: private, no-store`; O-39). Receipts don't count against the storage quota.
4. Allow **one pending payment per company**; a second gives `409 PAYMENT_ALREADY_PENDING`.
5. Refuse a smaller plan whose limits current usage exceeds (`409 PLAN_LIMIT_REACHED` with the resource, PLT-12 FR-9).
6. Allow withdrawing a pending payment (`DELETE /subscription/payments/{id}` → status `withdrawn`, the receipt soft-deleted).
7. List the company's payments, newest first, at `GET /subscription/payments`: plan, cycle, amount, transfer date, status, review date and rejection reason.
8. Work in read-only mode (PLT-11 allow-list).
9. Show the plan's price when known (F-02b), "Price on request" otherwise, and the VAT note "Prices exclude 15 % VAT."
10. Show the subscription summary (plan, state, end date — no amounts) on the company information page (US-015) for every user.

## Validation Rules

- `planCode`: an active plan. `billingCycle`: `monthly` or `annual`.
- `amount`: > 0 and ≤ 10 000 000 SAR, at most 2 decimals; stored as halalas.
- `transferredOn`: not in the future, not more than 60 days in the past.
- `reference`: up to 100 characters.
- `file`: required; PLT-07 checks for category `payment_proof`.

## Permission Rules

- `GET /subscription`: `subscription.view` (Company Administrator; the reduced summary on US-015 uses `company.view`).
- `GET/POST/DELETE /subscription/payments`: `subscription.pay` (Company Administrator).
- A company can only see and withdraw its own payments (tenant check).

## Database Impact

New table `payment`:

| Column                                                                     | Type                    | Notes                                           |
| -------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------- |
| `id`                                                                       | TEXT (UUID)             | PK                                              |
| `company_id`                                                               | TEXT                    | FK → `company`; indexed with `status`           |
| `subscription_id`                                                          | TEXT                    | FK → `subscription`                             |
| `plan_id`                                                                  | TEXT                    | FK → `plan`; plan asked for                     |
| `billing_cycle`                                                            | TEXT                    | `monthly`, `annual`                             |
| `amount_halalas`                                                           | INTEGER                 | as entered by the company                       |
| `transferred_on`                                                           | TEXT                    | `YYYY-MM-DD`                                    |
| `reference`                                                                | TEXT, nullable          |                                                 |
| `file_id`                                                                  | TEXT                    | receipt (PLT-07)                                |
| `status`                                                                   | TEXT                    | `pending`, `confirmed`, `rejected`, `withdrawn` |
| `submitted_by`, `submitted_at`                                             | TEXT, INTEGER           |                                                 |
| `reviewed_by`, `reviewed_at`                                               | TEXT, INTEGER, nullable | PLT-14                                          |
| `rejection_reason`                                                         | TEXT, nullable          | PLT-14                                          |
| `confirmed_plan_id`, `confirmed_billing_cycle`, `confirmed_amount_halalas` | nullable                | what the System Owner confirmed (PLT-14)        |
| `period_start`, `period_end`                                               | INTEGER, nullable       | the period this payment paid for                |
| audit columns                                                              |                         | standard                                        |

A partial unique index on `(company_id) WHERE status = 'pending'` enforces FR-4.

## API Requirements

- `GET /api/v1/subscription` → `{ plan, state, trialEndsAt, currentPeriodEnd, graceEndsAt, readOnlySince, billingCycle, usage: { users, projects, storageBytes }, limits: {…}, bankDetails: { bankName, beneficiary, iban }, pendingPayment }`.
- `GET /api/v1/subscription/payments` → list.
- `POST /api/v1/subscription/payments` → `201` with the payment.
- `DELETE /api/v1/subscription/payments/{id}` → `204`.

## UI Requirements

- Page at `<slug>/settings/subscription`, linked from the settings menu (administrators) and the banner.
- Status card, usage bars with text values, bank details with **Copy IBAN**, payment form in a dialog (full screen on phones, like the invite dialog), `FileDropzone` for the receipt, history as cards.
- Arabic and English, phone width first, IBAN shown left-to-right inside Arabic text.

## Error Handling

`PAYMENT_ALREADY_PENDING`, `PLAN_LIMIT_REACHED`, `PLAN_NOT_AVAILABLE`, PLT-07 file errors, validation errors per field.

## Notifications

On submission: every System Owner gets "New payment proof from {company}" (PLT-15). The company gets confirmation or rejection after review (PLT-14, PLT-15).

## Audit Requirements

`payment.submitted`, `payment.withdrawn`, plus PLT-07 `file.uploaded` / `file.deleted`.

## Acceptance Criteria

- An administrator sees plan, state, dates, usage and bank details, and can submit a payment with a receipt from a phone, in Arabic or English.
- A second pending payment is refused; a pending one can be withdrawn.
- Submitting works in read-only mode.
- A non-administrator can't open the page or the endpoints; the company information page shows them the plan and end date.

## Test Scenarios

- **Positive:** submit during trial, grace and read-only; withdraw; history after confirm and reject; upgrade to Pro.
- **Negative:** forged file type; 10 MB + 1 byte; future transfer date; amount with 3 decimals; downgrade over the user limit; another company's payment id; non-administrator.

## Future Improvements

Payment gateway (Mada, cards, Apple Pay) and SADAD; reading amounts from the receipt automatically; downloadable invoices (F-10).
