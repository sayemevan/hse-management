# PLT-03 — Arabic/English and Right-to-Left Foundation

| Field    | Value                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------ |
| Epic     | Platform / UI foundation                                                                               |
| Priority | Must                                                                                                   |
| Status   | Approved                                                                                               |
| Sources  | D-14, D-21, D-22 (PO decisions); Product Book Doc 00 §7, Doc 02 §6–7, Doc 05; Master Rules UI_UX_RULES |

## Business Goal

Arabic and English ship together in Phase 1 (D-14). Building this before the first screen avoids reworking every screen later.

## Description

All user-facing text comes from translation files. Layouts mirror correctly in right-to-left (RTL) mode. Dates and numbers are formatted for the active language and the user's time zone (Doc 02 §7: stored in UTC).

## Actors

All users.

## Preconditions

None.

## User Flow

1. A visitor opens the login page. The language is the one chosen earlier on this device, otherwise the company default, otherwise English.
2. The visitor can switch language from the login page.
3. After sign-in, the user's saved preference wins (D-21), on every device.

## Functional Requirements

The system shall:

1. Store every user-facing string in `messages/en.json` and `messages/ar.json`. Hard-coded UI text is a lint error.
2. Set `<html lang>` and `dir` (`ltr` / `rtl`) from the active language.
3. Use logical layout properties only (`ms-`/`me-`, `ps-`/`pe-`, `start`/`end`), so layouts mirror without per-screen code. Physical left/right utilities are a lint error.
4. Mirror directional icons (arrows, chevrons) in RTL; do not mirror logos, photos or numbers.
5. Format dates, times and numbers with the browser's `Intl` APIs for the active language. Use Western digits (0–9) in both languages (see O-10).
6. Show times in the user's time zone, falling back to the company's time zone.
7. Return API error messages as stable **codes**; the web app translates them. The API's English `message` remains as a fallback.
8. Load the Arabic font and the Latin font (O-6) only when they are needed.

## Validation Rules

- CI fails if a key exists in one language file but not the other.

## Permission Rules

None.

## Database Impact

`user.preferred_language` (nullable `en` / `ar`) and `company.default_language` — defined in US-001 and PLT-02.

## API Requirements

`PATCH /api/v1/auth/me` with `{ preferredLanguage }` saves the signed-in user's choice. The full profile editing comes with US-007 (Sprint 3).

## UI Requirements

- A language switcher (العربية / English) on the login page and in the user menu.
- Every Sprint 1 screen is checked in both directions at phone width.

## Error Handling

A missing translation key shows the English text and logs a warning in development; it never shows the raw key to users.

## Notifications

None.

## Audit Requirements

Changing the language preference is not audited (not an important business action).

## Acceptance Criteria

- Switching to Arabic sets `dir="rtl"` and the login page mirrors correctly on a phone-width screen.
- The choice survives a reload and, once signed in, applies on another device.
- CI fails when a translation key is missing in one language.
- No Sprint 1 screen contains hard-coded user-facing text.

## Test Scenarios

- **Positive:** switch language before and after login; company default applied for a new visitor.
- **Negative:** unsupported language value rejected by the API; missing key falls back to English.
- **Visual:** login, change password and sessions screens in both directions.

## Open point

- **O-10** Digits in Arabic: Western (0–9) or Eastern Arabic (٠–٩)? **Proposed: Western digits** in both languages, because record numbers, permit numbers and dates must look identical in reports and searches.

## Future Improvements

Hijri calendar display (Doc 02 §7, Q-30); more languages.
