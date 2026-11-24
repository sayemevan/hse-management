# PLT-10 — Subscription Lifecycle

| Field    | Value                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------- |
| Epic     | Platform / tenancy                                                                              |
| Priority | Must                                                                                            |
| Status   | Approved                                                                                        |
| Sources  | Product Book Doc 06 §2; D-07, D-18, D-29, D-30; O-13, O-20; PLT-06; T-22, T-23; O-31–O-34, O-38 |

## Business Goal

A company keeps working while it has paid or is in its trial or grace period, and becomes read-only — never deleted — when it hasn't paid. No one has to switch it by hand.

## Description

A subscription moves through `trial → active → grace → read_only` and back to `active` when a payment is confirmed. The rules below decide the state from the dates; the daily job `subscriptions.lifecycle` records each change, keeps `company.status` in step and triggers the emails (PLT-15).

```
trial ──(trial ends, no proof pending)──────────────▶ read_only
  │                                                     ▲
  └─(payment confirmed)─▶ active ─(period ends)─▶ grace ─(14 days)─┘
                            ▲                                       │
                            └──────────(payment confirmed)──────────┘
```

## Actors

The system (daily job, request-time check); System Owner (confirms payments, PLT-14).

## Preconditions

PLT-06 (plans and trial subscription), PLT-09 (job registry).

## Functional Requirements

The system shall:

1. Compute the **effective state** of a subscription at time `now` (T-22):
   - `trial` while `now < trial_ends_at`;
   - `active` while `now < current_period_end`;
   - `grace` while a paid period has ended and `now < current_period_end + GRACE_DAYS` (default 14, D-18);
   - `read_only` otherwise — including straight after an unpaid trial (O-31).
2. While a payment proof is **pending** (PLT-13), keep the state the company had at the deadline for up to `PENDING_PROOF_HOLD_DAYS` (default 5) after it (O-32). A rejected proof ends the hold at once.
3. On **payment confirmation** (PLT-14), set `plan_id`, `billing_cycle`, `current_period_start` and `current_period_end` (O-33):
   - during the trial: start = `trial_ends_at`;
   - while `active`: start = current `current_period_end`;
   - in `grace` or `read_only`: start = confirmation time;
   - end = start + 1 calendar month (monthly) or 12 calendar months (annual). A start on the 29th–31st ends on the last day of the target month if that day doesn't exist.
     It then sets `status = active` (or keeps `trial` if the period starts later), clears `grace_ends_at` and `read_only_since`, and sets `company.status = active` — all in one batch.
4. Run the daily job **`subscriptions.lifecycle`**: for each subscription whose stored status differs from its effective state, update `status`, `grace_ends_at` / `read_only_since`, and `company.status` (`read_only` for `read_only`, `active` otherwise, T-23) in one batch per company; clear the tenant cache; write the audit entry; ask PLT-15 for the matching emails. It also asks PLT-15 for the date-based reminders (trial ending, renewal due, grace ending).
5. Never change a company whose status is `suspended` or `pending_verification` (those are set by other flows).
6. Never delete data because of the subscription state (D-18).
7. Expose `SubscriptionService.accessFor(companyId, now)` → `{ state, plan, trialEndsAt, currentPeriodEnd, graceEndsAt, readOnlySince, pendingPayment }` for the other modules, the tenant profile (PLT-11) and the subscription page (PLT-13).
8. Make every lifecycle length configuration, not code: `TRIAL_DAYS` (exists), `GRACE_DAYS`, `PENDING_PROOF_HOLD_DAYS`.

## Validation Rules

- `billing_cycle` is `monthly` or `annual`.
- `current_period_end` > `current_period_start`.
- A confirmation for a plan that is inactive is refused (`PLAN_NOT_AVAILABLE`).

## Permission Rules

No endpoint of its own. Changes come from the job (actor `system`) or from a System Owner confirmation (PLT-14).

## Database Impact

`subscription` gains:

| Column                 | Type              | Notes                                                   |
| ---------------------- | ----------------- | ------------------------------------------------------- |
| `billing_cycle`        | TEXT, nullable    | `monthly`, `annual`; null during the trial              |
| `current_period_start` | INTEGER, nullable | UTC ms (`current_period_end` exists since Sprint 2)     |
| `grace_ends_at`        | INTEGER, nullable | Set when grace starts                                   |
| `read_only_since`      | INTEGER, nullable | Set when read-only starts                               |
| `pending_plan_id`      | TEXT, nullable    | FK → `plan`; plan of a confirmed period not started yet |

Index `(status, current_period_end)` and `(status, trial_ends_at)` for the daily job. The migration keeps the existing trial rows unchanged; trials that already ended in development data become `read_only` at the first job run.

## API Requirements

None directly; see PLT-11 (`GET /tenant`), PLT-13 and PLT-14.

## UI Requirements

None directly; the banner and pages are in PLT-11, PLT-13 and PLT-14.

## Error Handling

- One company failing in the job is logged and counted as `failed`; the job carries on with the others.
- Confirming a payment twice is refused (`PAYMENT_ALREADY_REVIEWED`, PLT-14).

## Notifications

Triggers PLT-15: trial ending, trial ended, renewal due, grace started, grace ending, read-only started, payment confirmed.

## Audit Requirements

`subscription.activated`, `subscription.renewed`, `subscription.plan_changed`, `subscription.grace_started`, `subscription.read_only_started`, `subscription.read_only_ended` — with old and new status, plan and dates. Actor `system` for the job; the System Owner for confirmations.

## Acceptance Criteria

- A trial with no payment becomes read-only at `trial_ends_at` (request-time) and is recorded as such by the next job run.
- A payment confirmed during the trial starts the paid period when the trial ends.
- A paid period that ends without renewal gives 14 days of grace, then read-only.
- A confirmed payment in read-only mode makes the company writable at once.
- A pending proof holds the state for up to 5 days.
- Running the job twice changes nothing the second time.

## Test Scenarios

- **Positive (fixed clock):** every transition; period end from 31 January (monthly → 28/29 February) and 29 February (annual → 28 February); early renewal stacks on the current period; plan change starts with the new period.
- **Negative:** suspended company untouched; inactive plan on confirmation; a job run with a database error for one company.

## Future Improvements

Manual trial extension and credits (Sprint 19, O-38); plan change mid-period with proration; automatic payment matching once a gateway or bank feed exists.
