# PLT-06 — Plan Catalogue & Trial Subscription

| Field    | Value                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| Epic     | Platform / tenancy                                                                          |
| Priority | Must                                                                                        |
| Status   | Approved                                                                                    |
| Sources  | Product Book Doc 06 §2 (subscriptions), Doc 08 §5; D-17, D-18, D-27, D-28, D-29, D-30; T-13 |

## Business Goal

Every company is on one of three plans, with limits, and starts with a 14-day trial when it is approved (D-29).

## Description

The plan catalogue is seeded data. Approving a registration (US-011.3) creates the company's subscription in `trial` status. Sprint 4 adds limit enforcement, payment, renewal, grace and read-only mode. This spec only defines the data and the trial start.

## Actors

Applicant (chooses a plan); System Owner (can change the plan during review); the system (starts the trial).

## Preconditions

None.

## Functional Requirements

The system shall:

1. Seed three plans: **Basic** (1 project, 25 users, 5 GB), **Pro** (5 projects, 100 users, 50 GB), **Enterprise** (unlimited projects and users, 500 GB). "Unlimited" is stored as `NULL`.
2. Store monthly and annual prices in SAR as nullable values, excluding VAT, until F-02b is decided. Show "Price on request" while a price is null.
3. Store the plan's name in English and Arabic.
4. Publish the catalogue at `GET /plans` (public, used by the registration form).
5. When a registration is approved, create a `subscription` with `status = trial`, `trial_started_at = approval time` and `trial_ends_at = approval time + 14 days`. The length is configurable (`TRIAL_DAYS`, default 14).
6. Never delete plans. A plan can be marked `is_active = false` to hide it from new registrations.

## Validation Rules

- A registration may only choose an active plan.
- Limits are positive integers or `NULL` (unlimited).

## Permission Rules

- `GET /plans` is public and returns active plans only.
- Changing plans or prices is not part of this sprint (it comes with Administration).

## Database Impact

New table `plan`:

| Column                                          | Type              | Notes                                |
| ----------------------------------------------- | ----------------- | ------------------------------------ |
| `id`                                            | TEXT (UUID)       | PK                                   |
| `code`                                          | TEXT              | `basic`, `pro`, `enterprise`; unique |
| `name_en`, `name_ar`                            | TEXT              |                                      |
| `max_projects`, `max_users`                     | INTEGER, nullable | `NULL` = unlimited                   |
| `max_storage_bytes`                             | INTEGER           |                                      |
| `monthly_price_halalas`, `annual_price_halalas` | INTEGER, nullable | SAR × 100, excluding VAT             |
| `sort_order`                                    | INTEGER           |                                      |
| `is_active`                                     | INTEGER (boolean) |                                      |
| audit columns                                   |                   | standard                             |

New table `subscription`:

| Column                              | Type              | Notes                                                         |
| ----------------------------------- | ----------------- | ------------------------------------------------------------- |
| `id`                                | TEXT (UUID)       | PK                                                            |
| `company_id`                        | TEXT              | FK → `company`; unique (one per company)                      |
| `plan_id`                           | TEXT              | FK → `plan`                                                   |
| `status`                            | TEXT              | `trial` (Sprint 2); `active`, `grace`, `read_only` (Sprint 4) |
| `trial_started_at`, `trial_ends_at` | INTEGER           | UTC ms                                                        |
| `current_period_end`                | INTEGER, nullable | Sprint 4                                                      |
| audit columns                       |                   | standard                                                      |

Money is stored as integer halalas to avoid rounding errors.

## API Requirements

`GET /api/v1/plans` → `[{ code, name, maxProjects, maxUsers, maxStorageBytes, monthlyPrice, annualPrice }]`. `name` is in the request's language, and prices are null while unknown.

## UI Requirements

Plan cards on the registration form (US-011.1): name, limits ("Up to 25 users", "Unlimited projects"), storage, and price or "Price on request".

## Error Handling

Choosing an inactive or unknown plan gives a validation error on the plan field.

## Notifications

None in Sprint 2. The "trial ending soon" reminder comes in Sprint 4.

## Audit Requirements

Subscription creation is audited as part of the approval (`registration.approved`, US-011.3).

## Acceptance Criteria

- A fresh database has exactly the three plans with the D-27 and D-28 limits.
- `GET /plans` returns them in order with names in the requested language.
- An approved company has one `trial` subscription ending exactly 14 days after approval.

## Test Scenarios

- **Positive:** catalogue in English and Arabic; trial dates computed from a fixed clock.
- **Negative:** inactive plan rejected at registration; a second subscription for the same company rejected by the unique constraint.

## Future Improvements

Plan changes and proration, add-ons and coupons (with billing, Sprint 4 onwards).
