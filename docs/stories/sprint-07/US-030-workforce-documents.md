# US-030 — Workforce Documents

| Field    | Value                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Workforce Documents")                                                                 |
| Priority | Must                                                                                                                          |
| Status   | Approved                                                                                                                      |
| Sources  | Product Book Doc 14, Doc 09 §12, Doc 18; Master Rules "File Management"; T-48, T-49, T-50, T-56; O-71, O-75, O-80, O-87, O-90 |

## Business Goal

Contractors in Saudi Arabia must hold a valid residence permit and work permit to be on site; clients audit these. The documents and their expiry dates must be kept securely in one place (Doc 09 §12).

## User Story

As an **HSE Manager**, I want to upload each person's identity and employment documents with their expiry dates, so that I can show they are allowed to work and renew documents in time.

## Description

The profile's **Documents** tab lists personal documents with their expiry badge. Documents are personal data: visible only with `workforce.personal.view` or to the linked user (O-75). **Renew** adds the new document and marks the earlier one Replaced (T-48), which keeps version history (Master Rules "File Management").

**Types (O-87):** Passport, National ID, Residence permit (Iqama), Work permit, Employment contract, Other (name required).

**Fields:** type (required), name (required for Other), document number (optional; required for Passport, National ID and Residence permit), issuing country (required for Passport; defaults to the nationality), issue date (optional), expiry date (required for Passport, Residence permit and Work permit; optional otherwise), copy (**required**, PDF / JPEG / PNG, 10 MB), note (optional).

**Number uniqueness (O-80):** among current documents of the company, a number is unique per type and issuing country ("This passport number is already recorded for Ahmed Ali").

## Actors

Holders of `workforce.personal.view` (read); `workforce.manage` + `workforce.personal.view` (change); the linked user (own, read-only).

## Preconditions

- The profile exists and isn't archived (to change); the company isn't read-only.

## User Flow

1. Profile → **Documents**: rows show type, masked number ("•••• 4821"), country, expiry badge; "Show replaced and voided".
2. **Add document** → the form → **Save**.
3. Row menu: **Open** (shows the full number and opens the copy), **Edit**, **Renew**, **Void** (reason).

## Functional Requirements

The system shall:

1. List a person's documents to authorised readers only; number masked to the last 4 characters in the list; full number in `GET …/documents/{id}`.
2. Create, edit, renew and void (T-48), enforcing the type rules and number uniqueness.
3. Store copies in `workforce_personal` (T-49); serve them only to authorised readers and write `workforce.document.opened` to the audit on each detail read or file opening.
4. Count document expiries in the compliance summary only for readers with `workforce.personal.view` (PLT-20).
5. Never return document data in the directory, project lists, notifications or History for readers without the permission (T-56).

## Validation Rules

| Field           | Rule                                                                                            | Message                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Type            | One of the six                                                                                  | "Choose a type."                                                             |
| Name            | Required for Other, 2–120                                                                       | "Enter the document name."                                                   |
| Number          | 3–30 letters, numbers, `-`; required for Passport, National ID, Residence permit; unique (O-80) | "Enter the document number." / "This number is already recorded for {name}." |
| Issuing country | Required for Passport                                                                           | "Choose the issuing country."                                                |
| Issue date      | Optional, not in the future                                                                     | "The issue date can't be in the future."                                     |
| Expiry date     | Required for Passport, Residence permit, Work permit; after the issue date                      | "Enter the expiry date."                                                     |
| Copy            | Required; PDF, JPEG or PNG, up to 10 MB                                                         | "Upload a copy of the document."                                             |

## Permission Rules

- `workforce.personal.view` (company, new; defaults in US-028 / O-75) to read; plus `workforce.manage` to change. No other new permission.

## Database Impact

New table `workforce_document`: `id`, `company_id`, `workforce_member_id`, `type`, `name`, `number`, `number_key` (upper-cased), `issuing_country`, `issued_on`, `expires_on`, `file_id` (not null), `note`, `replaces_id`, `replaced_at`, `voided_at`, `voided_by`, `void_reason`, audit columns. Indexes: (`company_id`, `type`, `issuing_country`, `number_key`) for the uniqueness check among current documents (checked by the service); (`workforce_member_id`, `voided_at`, `replaced_at`); (`company_id`, `expires_on`).

## API Requirements

- `GET /api/v1/workforce/{memberId}/documents?include=history` → masked list.
- `GET …/documents/{id}` → full details (audited).
- `POST …/documents` (multipart) → `201`; `PATCH …/{id}`; `POST …/{id}/renew` (multipart); `POST …/{id}/void` `{ reason }`; `GET …/{id}/file` (audited).

## UI Requirements

- Tab hidden without the permission; numbers masked in lists and in `<bdi dir="ltr">`.
- Opening shows the copy inline for images and PDFs, with a download button.

## Error Handling

| Case                       | Response                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| Number taken               | `409 WORKFORCE_DOCUMENT_NUMBER_TAKEN`                                |
| No permission              | `403 FORBIDDEN` (list), `404` (file)                                 |
| Record voided              | `409 WORKFORCE_RECORD_VOIDED`                                        |
| Profile archived           | `409 WORKFORCE_ARCHIVED`                                             |
| File missing, type or size | `422 VALIDATION_FAILED` / `FILE_TYPE_NOT_ALLOWED` / `FILE_TOO_LARGE` |
| Storage full               | `422 PLAN_LIMIT_REACHED`                                             |
| Read-only company          | `403 SUBSCRIPTION_READ_ONLY`                                         |

## Notifications

Expiry reminders through PLT-20 (only recipients with `workforce.personal.view`; the linked user about their own documents).

## Audit Requirements

`workforce.document.created`, `.updated` (old and new), `.renewed`, `.voided`, `.opened` (detail or file, with the reader). History entries shown only with `workforce.personal.view`.

## Acceptance Criteria

- An HSE Manager uploads Ahmed's Iqama with number and expiry; the list shows "•••• 4821" and "Valid until …".
- A Safety Officer doesn't see the Documents tab; the document and file URLs return `403` / `404`; the directory and digest contain nothing about the Iqama.
- The same passport number and country on another person is refused.
- Renewing the Iqama keeps the old copy under "Show replaced and voided".
- Each opening appears in the audit log with the reader.

## Test Scenarios

- **Positive:** each type with its required fields; renew; void; masked list and full detail; linked user reads own.
- **Negative:** each validation rule; uniqueness across people and ignoring case; missing copy; reads and files without permission; generic `/files/{id}` returns `404` for the copy; archived profile; read-only company; ids of another company or person.

## Future Improvements

OCR of passport and Iqama data; checking Iqama status with government services; document requirements per category (for example visitors need a National ID only); erasure and export tools once Q-05 is answered.
