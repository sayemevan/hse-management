# US-012 — Edit Company Profile

| Field    | Value                                              |
| -------- | -------------------------------------------------- |
| Epic     | Epic 02 — Company Management                       |
| Priority | Must                                               |
| Status   | Approved                                           |
| Sources  | Product Book Doc 14, Doc 08 §3, Doc 17; D-16; O-29 |

## Business Goal

Let the Company Administrator keep the company's details correct after registration, because they appear on reports, documents and the sign-in page.

## Description

The **Company profile** page shows what was entered at registration and lets the administrator change it. The subdomain is shown but can't be changed (D-16).

## Actors

Company Administrator.

## Preconditions

Signed in on the company's subdomain with `company.edit` (PLT-08). The company is `active`.

## User Flow

1. Open **Settings → Company**.
2. Change any of: company name, registration number, country, city, address, time zone, contact email, contact phone.
3. Select **Save**. See "Company details saved."

## Functional Requirements

The system shall:

1. Update only the fields sent, and keep the subdomain and status out of reach (O-29).
2. Pre-fill the time zone from the country when the country changes, as on registration (O-17); the administrator can override it.
3. Refresh the tenant cache (PLT-02, KV) so the new name shows on the sign-in page at once.
4. Use optimistic concurrency: the form sends the `updatedAt` it loaded, and a newer change by someone else is reported instead of overwritten.

## Validation Rules

Same rules as registration (US-011.1) for name, country, city, time zone, contact email and phone. Registration number: optional, up to 50 characters. Address: optional, up to 300 characters.

## Permission Rules

`company.edit` (Company Administrator of this company).

## Database Impact

Adds `company.registration_number` and `company.address`. Updates `company`; writes `audit_log`.

## API Requirements

`PATCH /api/v1/company` with any of the fields above and `updatedAt` → the updated company, or `409 CONFLICT`.

## UI Requirements

- Same field components as the registration form (country groups, time-zone select).
- Subdomain shown read-only with "To change your address, contact support."
- Unsaved-changes warning when leaving the page.
- Arabic and English, phone width.

## Error Handling

| Situation         | Message                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| Changed meanwhile | "Someone else changed these details. Reload to see the latest version." |
| Company read-only | "Your company account is read-only until payment is confirmed."         |

## Notifications

None.

## Audit Requirements

`company.updated` with the changed fields and their old and new values (company data, not personal secrets).

## Acceptance Criteria

- The administrator can change every listed field; the subdomain can't be changed through the API.
- The new name shows on the sign-in page immediately.
- A concurrent change is reported, not overwritten.

## Test Scenarios

- **Positive:** change each field; country change pre-fills the time zone.
- **Negative:** send `slug` or `status` (ignored or rejected); stale `updatedAt`; non-administrator; read-only company; invalid email.

## Future Improvements

Subdomain change by the System Owner with redirects from the old address; custom domains (later phase, D-06).
