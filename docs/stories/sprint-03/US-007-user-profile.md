# US-007 — User Profile

| Field    | Value                                                              |
| -------- | ------------------------------------------------------------------ |
| Epic     | Epic 01 — Authentication & Security                                |
| Priority | Must                                                               |
| Status   | Approved                                                           |
| Sources  | Product Book Doc 14, Doc 16 (User Profile); D-14, D-21; O-25, O-27 |

## Business Goal

Let every user see their account details and keep their name, contact number, language and time zone correct, so records and reports show the right information.

## Description

A **My profile** page that brings together what Sprint 1 spread over separate pages: personal details, language, time zone, and links to **Change password** (US-005) and **Active sessions** (US-010). Sprint 1 already lets the user change language from the header; that preference is now also on this page.

## Actors

Every signed-in user, including the System Owner.

## Preconditions

The user is signed in.

## User Flow

1. Open the user menu → **My profile**.
2. See full name, email (read-only), phone, role(s), company, language, time zone, last sign-in.
3. Select **Edit**, change any editable field, then **Save**.
4. See "Your profile has been updated." A language change switches the interface immediately.

## Functional Requirements

The system shall:

1. Let the user change **full name, phone, preferred language and time zone** (O-27). Email, role and company are read-only.
2. Offer "Use company default" for language and time zone (D-21); the effective value is shown next to it.
3. Apply a language change at once (direction RTL/LTR included) and use it for the user's emails from then on.
4. Save only fields that changed; reject unknown fields.

## Validation Rules

- Full name: 2–100 characters, trimmed.
- Phone: optional, E.164 format after normalising spaces and dashes (e.g. `+966501234567`).
- Language: `en`, `ar` or null (company default).
- Time zone: a valid IANA name or null.

## Permission Rules

A user can view and edit only their own profile. Editing others is Administration (Sprint 19).

## Database Impact

Adds `user.phone`. Updates `user.full_name`, `phone`, `preferred_language`, `time_zone`. Writes `audit_log`.

## API Requirements

- `GET /api/v1/auth/me`: adds `phone`, `timeZone`, `effectiveLanguage`, `effectiveTimeZone`, `permissions` (PLT-08).
- `PATCH /api/v1/auth/me` with any of `{ fullName, phone, preferredLanguage, timeZone }` (extends the Sprint 1 endpoint, which accepted only `preferredLanguage`).

## UI Requirements

- View mode and edit mode on one page; avatar with initials (O-25: no picture yet).
- Phone field with `inputmode="tel"`, always left-to-right inside Arabic text.
- Time-zone select grouped by region with the current offset.
- Links to **Change password** and **Active sessions**.
- Arabic and English, phone width.

## Error Handling

| Situation      | Message                                                          |
| -------------- | ---------------------------------------------------------------- |
| Invalid phone  | "Enter the number with the country code, e.g. +966 50 123 4567." |
| Name too short | "Enter your full name."                                          |

## Notifications

None.

## Audit Requirements

`user.profile.updated` with the names of the changed fields (not their values, except language and time zone).

## Acceptance Criteria

- The user can update name, phone, language and time zone; email, role and company can't be changed.
- Choosing "company default" follows the company setting when it changes later.
- A language change applies immediately and to later emails.

## Test Scenarios

- **Positive:** change each field; reset language to company default; System Owner edits own profile.
- **Negative:** phone without country code; 1-character name; unknown time zone; attempt to send `email` or `roleCode`.

## Future Improvements

Profile picture (O-25); email change with re-verification; notification preferences (Sprint 6).
