# US-027 — Certificates

| Field    | Value                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------- |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Certificates: Upload, Expiry Tracking, Renewal Reminder") |
| Priority | Must                                                                                              |
| Status   | Approved                                                                                          |
| Sources  | Product Book Doc 14, Doc 09 §7, §9, §17, Doc 18; T-48, T-49, T-50, T-56; O-71, O-74, O-83, O-88   |

## Business Goal

Crane operators, riggers and drivers may only work with a valid licence. Expired certificates must be clearly identified and renewed in time (Doc 09 §9, §17).

## User Story

As a **Safety Officer**, I want to keep each person's certificates and licences with their expiry dates and copies, so that nobody works with an expired certificate.

## Description

The profile's **Certificates** tab lists certificates with their expiry badge. **Renew** adds the new certificate and marks the earlier one Replaced (T-48). A certificate may name the competency it proves (PLT-21).

**Types (O-88):** Safety passport, Equipment licence, Operator licence, Specialised training certificate, Other (name required). Medical clearance is recorded under Medical fitness (US-028).

**Fields:** type (required), name (required for Other; optional detail otherwise, for example "Mobile crane up to 50 t"), competency (optional), certificate number (optional), issuing body (optional), issue date (required), expiry date (optional, "No expiry" must be chosen explicitly), copy (optional, 10 MB). A certificate without a copy shows "No copy uploaded".

## Actors

Holders of `workforce.view` (read), `workforce.manage` (change); the linked user (own, read-only).

## Preconditions

- The profile exists and isn't archived (to change); the company isn't read-only.

## User Flow

1. Profile → **Certificates**: rows show type and name, number, issuer, expiry badge, copy indicator; "Show replaced and voided".
2. **Add certificate** → the form → **Save**.
3. Row menu: **Open copy**, **Edit**, **Renew** (form pre-filled with type, name, competency, issuer; new number, dates and copy), **Void** (reason).

## Functional Requirements

The system shall:

1. List a person's certificates with expiry state; current only unless `include=history`.
2. Create, edit, renew and void as for training records (US-026 FR-2–FR-5), with renew through `POST …/{id}/renew`.
3. Require "No expiry" to be explicit: `expiresOn` or `noExpiry: true`.
4. Serve the copy through `GET …/certificates/{id}/file` with `workforce.view` (or own linked record).
5. Expose current certificates per competency and type to later modules through `WorkforceDirectory`.

## Validation Rules

| Field              | Rule                                      | Message                                      |
| ------------------ | ----------------------------------------- | -------------------------------------------- |
| Type               | One of the five                           | "Choose a type."                             |
| Name               | Required for Other, 2–120; else up to 120 | "Enter the certificate name."                |
| Certificate number | Optional, up to 60                        | "Number is too long."                        |
| Issuing body       | Optional, up to 120                       | "Issuing body is too long."                  |
| Issue date         | Required, not in the future               | "The issue date can't be in the future."     |
| Expiry             | Date after issue date, or No expiry       | "Enter the expiry date or choose No expiry." |
| Copy               | PDF, JPEG or PNG, up to 10 MB             | "Use a PDF, JPEG or PNG file up to 10 MB."   |

## Permission Rules

- `workforce.view` (read and open copies); `workforce.manage` (change). No new permission.

## Database Impact

New table `workforce_certificate`: `id`, `company_id`, `workforce_member_id`, `type`, `name`, `competency_id`, `number`, `issuer`, `issued_on`, `expires_on` (nullable; null only with `no_expiry = true`), `no_expiry`, `file_id`, `replaces_id`, `replaced_at`, `voided_at`, `voided_by`, `void_reason`, audit columns. Indexes as for `workforce_training`, plus (`company_id`, `type`).

## API Requirements

- `GET /api/v1/workforce/{memberId}/certificates?include=history`.
- `POST …/certificates` (multipart) → `201`; `PATCH …/{id}`; `POST …/{id}/renew` (multipart) → `201` new record; `POST …/{id}/void` `{ reason }`; `GET …/{id}/file`.

## UI Requirements

- Reuses the record list and form components of US-026; "No copy uploaded" shown as text with an icon.

## Error Handling

As US-026.

## Notifications

Expiry reminders through PLT-20 ("Operator licence of Ahmed Ali expires in 7 days" counted in the digest; the linked user gets their own notice).

## Audit Requirements

`workforce.certificate.created`, `.updated` (old and new), `.renewed`, `.voided`. Profile History entries.

## Acceptance Criteria

- An Operator licence with expiry yesterday shows "Expired" and makes the person's badge "Expired".
- **Renew** creates a new certificate and the old one shows "Replaced" with a link to the new one; reminders stop for the old one.
- Saving without an expiry date and without "No expiry" is refused.

## Test Scenarios

- **Positive:** each type; no expiry; renew; void; edit copy; history.
- **Negative:** each validation rule; renew a voided or replaced certificate; archived profile; file rules; read-only company; no permission; ids of another company or person.

## Future Improvements

Reading certificate details from a photo (OCR); verifying certificates with issuers; required certificates per job position.
