# US-013 — Company Settings

| Field    | Value                                                       |
| -------- | ----------------------------------------------------------- |
| Epic     | Epic 02 — Company Management                                |
| Priority | Must                                                        |
| Status   | Approved                                                    |
| Sources  | Product Book Doc 08 §4, Doc 02 §7 (Date & Time); D-21; O-28 |

## Business Goal

Let each company make the platform match how it works: its language, how dates and times are written, and its working week.

## Description

A **Preferences** page with company-wide defaults. Users who haven't chosen their own language or time zone follow these defaults (D-21).

## Actors

Company Administrator (edits); every user of the company (affected).

## Preconditions

Signed in on the company's subdomain with `company.settings.edit` (PLT-08).

## User Flow

1. Open **Settings → Preferences**.
2. Change default language, date format, time format, first day of the week and working days. A preview shows today's date and time in the chosen formats.
3. Select **Save**.

## Functional Requirements

The system shall:

1. Store one `company_settings` row per company, created with defaults on approval and back-filled for existing companies by the migration.
2. Offer (O-28):
   - **Default language**: English or Arabic (stored on `company.default_language`).
   - **Date format**: `DD/MM/YYYY` (default), `MM/DD/YYYY`, `YYYY-MM-DD`.
   - **Time format**: 24-hour (default) or 12-hour.
   - **First day of the week**: Sunday (default), Saturday, Monday.
   - **Working days**: any of the seven days; default Sunday to Thursday.
3. Return the settings with `GET /auth/me`, so the web app formats every date and time with them (Western digits in both languages, O-10).
4. Keep the Gregorian calendar (Hijri is a future option).

## Validation Rules

Each value from its list; at least one working day.

## Permission Rules

Read: every active user of the company. Edit: `company.settings.edit`.

## Database Impact

New table `company_settings`: `company_id` (PK, FK), `date_format`, `time_format`, `week_start`, `working_days` (7-bit mask), audit columns. Updates `company.default_language`.

## API Requirements

- `GET /api/v1/company/settings`.
- `PUT /api/v1/company/settings` with the full object and `updatedAt` → saved settings or `409`.

## UI Requirements

Radio groups for formats with an example next to each option; day chips for working days; live preview. Arabic and English, phone width.

## Error Handling

| Situation      | Message                            |
| -------------- | ---------------------------------- |
| No working day | "Choose at least one working day." |

## Notifications

None.

## Audit Requirements

`company.settings.updated` with old and new values.

## Acceptance Criteria

- The administrator can change every setting; users see dates and times in the new format after the next page load.
- Users without a personal language follow the new default language.
- Existing companies get default settings from the migration.

## Test Scenarios

- **Positive:** each option; preview matches; user with no language preference follows the default.
- **Negative:** no working days; unknown format; non-administrator.

## Future Improvements

Hijri calendar display; default notification preferences (Sprint 6); company holidays for scheduling.
