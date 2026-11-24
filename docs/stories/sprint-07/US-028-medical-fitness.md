# US-028 — Medical Fitness

| Field    | Value                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Medical: Fitness, Expiry")                     |
| Priority | Must                                                                                   |
| Status   | Approved                                                                               |
| Sources  | Product Book Doc 14, Doc 09 §10, Doc 18; T-48, T-49, T-50, T-56; O-73–O-75, O-86, O-90 |

## Business Goal

Site teams need to know whether a person is medically fit for work, and until when, without the platform holding medical details it doesn't need (Doc 09 §10).

## User Story

As an **HSE Manager**, I want to record each person's medical fitness result and its validity, so that supervisors know who is fit to work and the restrictions they must respect.

## Description

The profile's **Medical** tab shows the **current medical status** and the history of checks. The latest current check (by assessment date) gives the status. Two levels of visibility (O-73, O-75):

| Reader has                | Sees                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `workforce.view`          | Fitness result, assessment date, valid until, expiry badge, "Has restrictions" flag |
| `workforce.personal.view` | Also the restriction note, clinic and the copy                                      |

**Fields (O-86):** fitness (Fit, Fit with restrictions, Unfit), assessment date (required), valid until (required for Fit and Fit with restrictions; not allowed for Unfit), clinic (optional), restriction note (required for Fit with restrictions, up to 200, for example "No work at height"), copy (optional, PDF / JPEG / PNG, 10 MB, category `workforce_personal`). **No diagnosis or medical history fields.**

**Medical status shown on the profile:** Fit / Fit with restrictions (with expiry badge), Unfit, Expired (latest Fit check passed its date), Not recorded.

## Actors

Holders of `workforce.view` (status), `workforce.personal.view` (details), `workforce.manage` + `workforce.personal.view` (change); the linked user (own, including details).

## Preconditions

- The profile exists and isn't archived (to change); the company isn't read-only.

## User Flow

1. Profile → **Medical**: a status panel ("Fit with restrictions · valid until 30 Jun 2027"), then the check history.
2. **Record medical check** → the form → **Save**. The new check becomes the current status if its assessment date is the latest.
3. Row menu: **Open copy**, **Edit**, **Void** (reason).

## Functional Requirements

The system shall:

1. List a person's medical checks, newest first; return details only to readers with `workforce.personal.view` (or the linked user); others get status fields only, and `hasFile` is omitted.
2. Create, edit and void checks (T-48). A new check doesn't replace earlier ones; the status is always taken from the latest current check.
3. Store copies in `workforce_personal` (T-49); serve them only with `workforce.personal.view` or to the linked user, writing an audit entry for each opening.
4. Return the medical status in the profile, the compliance summary (PLT-20: missing, unfit, expiring, expired) and `WorkforceDirectory.availability`.

## Validation Rules

| Field            | Rule                                                                                   | Message                                       |
| ---------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| Fitness          | One of the three                                                                       | "Choose the result."                          |
| Assessment date  | Required, not in the future                                                            | "The assessment date can't be in the future." |
| Valid until      | Required for Fit and Fit with restrictions, after the assessment date; empty for Unfit | "Enter the date the result is valid until."   |
| Restriction note | Required for Fit with restrictions, 3–200; empty otherwise                             | "Describe the restriction."                   |
| Clinic           | Optional, up to 120                                                                    | "Clinic is too long."                         |
| Copy             | PDF, JPEG or PNG, up to 10 MB                                                          | "Use a PDF, JPEG or PNG file up to 10 MB."    |

## Permission Rules

- **`workforce.personal.view`** (company, new). Proposed defaults (O-75): CA ✓, HD ✓, HM ✓, PM —, SO —, SE —, SV —, FM —, IN —, WK —, CL —, CO —, AU —. Company-editable. Shared with US-030.
- Change: `workforce.manage` **and** `workforce.personal.view`.

## Database Impact

New table `workforce_medical`: `id`, `company_id`, `workforce_member_id`, `fitness` (`fit`, `fit_with_restrictions`, `unfit`), `assessed_on`, `expires_on` (nullable), `clinic`, `restriction_note`, `file_id`, `voided_at`, `voided_by`, `void_reason`, audit columns. Indexes: (`workforce_member_id`, `voided_at`, `assessed_on`); (`company_id`, `expires_on`).

## API Requirements

- `GET /api/v1/workforce/{memberId}/medical` → `{ status: { fitness, expiresOn, expiryState, hasRestrictions } | null, items: [ … ] }` with details per FR-1.
- `POST …/medical` (multipart) → `201`; `PATCH …/{id}`; `POST …/{id}/void` `{ reason }`; `GET …/{id}/file`.

## UI Requirements

- Status panel at the top with icon and text; the restriction note shown in a distinct box for readers who may see it, "Has restrictions — ask the HSE Manager" for others.
- Overview tab shows the medical status line.

## Error Handling

| Case                               | Response                                         |
| ---------------------------------- | ------------------------------------------------ |
| Details or file without permission | `404` for the file; fields omitted from the list |
| Record voided                      | `409 WORKFORCE_RECORD_VOIDED`                    |
| Profile archived                   | `409 WORKFORCE_ARCHIVED`                         |
| Read-only company                  | `403 SUBSCRIPTION_READ_ONLY`                     |

## Notifications

Expiry reminders through PLT-20 (counted only for readers with `workforce.personal.view`; status-only readers see the badge).

## Audit Requirements

`workforce.medical.created`, `.updated` (old and new; restriction note included only in the audit, which is not shown in project screens), `.voided`, `.file_opened`. History entries visible only with `workforce.personal.view` (T-56).

## Acceptance Criteria

- A Safety Officer sees "Fit with restrictions · valid until 30 Jun 2027 · Has restrictions" but not the note, the clinic or the copy, and the file URL returns `404`.
- An HSE Manager sees the note "No work at height" and opens the copy; the audit records the opening.
- A person with no check shows "Medical not recorded" and the badge "Check".
- Recording Unfit with a valid-until date is refused.

## Test Scenarios

- **Positive:** each result; status from the latest check when an older check is added later; void the latest (status falls back to the previous); linked user sees own details.
- **Negative:** each validation rule; detail fields absent without permission; file `404` without permission; change without `workforce.personal.view`; archived profile; read-only company; ids of another company or person.

## Future Improvements

Fitness requirements per job position; occupational health provider integration; scheduling of periodic checks.
