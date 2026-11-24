# US-015 — Company Information Page

| Field    | Value                                                         |
| -------- | ------------------------------------------------------------- |
| Epic     | Epic 02 — Company Management                                  |
| Priority | Should                                                        |
| Status   | Approved                                                      |
| Sources  | Product Book Doc 14 ("Manage Company Information"), Doc 08 §3 |

## Business Goal

Give every user of a company one place to see the company's official details and who to contact, and give the administrator a quick view of the account.

## Description

Doc 14 lists "Manage Company Information" next to "Edit Company" without more detail. This story reads it as the **read side**: a company information page for all users, with an administrator-only summary of the account. Editing stays in US-012 and US-013.

## Actors

Every active user of the company; Company Administrator (extra section).

## Preconditions

Signed in on the company's subdomain with `company.view` (PLT-08).

## User Flow

1. Open the user menu → **Company**.
2. See the logo, name, registration number, country, city, address, contact email and phone, and the company's time zone and language.
3. Administrators also see: subdomain, plan, trial or subscription status with its end date, number of users against the plan limit, storage used against the plan quota, and an **Edit** button (US-012).

## Functional Requirements

The system shall:

1. Return the company profile to every active user of the company.
2. Return the account summary (plan, subscription status and dates, user count, storage used) only to users with `company.edit`.
3. Show the trial end date prominently while the company is in trial.

## Validation Rules

None (read only).

## Permission Rules

Profile: `company.view`. Account summary: `company.edit`.

## Database Impact

None (reads `company`, `subscription`, `plan`, `user`, `file`).

## API Requirements

`GET /api/v1/company` → `{ profile, account? }`; `account` is present only for administrators.

## UI Requirements

Read-only cards; contact email and phone are tappable links (`mailto:`, `tel:`); usage bars for users and storage with text values (not colour only). Arabic and English, phone width.

## Error Handling

Standard (`403`, network error with **Try again**).

## Notifications

None.

## Audit Requirements

None (reads aren't audited).

## Acceptance Criteria

- Every company user sees the company profile.
- Only administrators see plan, subscription, users and storage.
- Trial companies show the trial end date.

## Test Scenarios

- **Positive:** worker sees profile only; administrator sees the summary; trial date shown.
- **Negative:** other company's user (refused by tenant check); System Owner on the subdomain.

## Future Improvements

Billing history and invoices (Sprint 4); company activity timeline (Sprint 6).
