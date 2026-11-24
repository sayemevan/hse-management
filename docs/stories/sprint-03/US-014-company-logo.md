# US-014 — Upload Company Logo

| Field    | Value                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Epic     | Epic 02 — Company Management                                            |
| Priority | Should                                                                  |
| Status   | Approved                                                                |
| Sources  | Product Book Doc 08 §3–4 (Company Branding), Doc 17; O-11, O-30; PLT-07 |

## Business Goal

Let users recognise their company's workspace at a glance, and put the company's logo on its pages (and, later, on its reports).

## Description

The Company Administrator uploads a logo. It appears on the company's sign-in page and in the app header, in place of the platform mark. It can be replaced or removed.

## Actors

Company Administrator.

## Preconditions

`company.logo.edit` (PLT-08); PLT-07 in place.

## User Flow

1. Open **Settings → Company → Logo**.
2. Choose or drop an image. See a preview on a light and a dark background.
3. Select **Save logo**. The header updates.
4. **Remove logo** (with confirmation) brings back the platform mark.

## Functional Requirements

The system shall:

1. Store the image through PLT-07 in category `company_logo` (PNG, JPEG, WebP; 2 MB; O-30).
2. Set `company.logo_file_id` to the new file and soft-delete the previous logo file, in one batch.
3. Serve the current logo publicly at `GET /company/logo` on the company's subdomain (the sign-in page needs it before sign-in), with an `ETag` and a cache of 1 hour.
4. Refresh the tenant cache so the change shows at once.

## Validation Rules

PLT-07 `company_logo` rules.

## Permission Rules

Change or remove: `company.logo.edit`. View: public on the company's subdomain.

## Database Impact

Adds the foreign key `company.logo_file_id → file.id`. Inserts `file`; updates `company`; writes `audit_log`.

## API Requirements

- `PUT /api/v1/company/logo` (`multipart/form-data`, field `file`) → `{ logoUrl }`.
- `DELETE /api/v1/company/logo` → `204`.
- `GET /api/v1/company/logo` → image or `404`.

## UI Requirements

`FileDropzone` (PLT-07); preview at the real header size; image shown with `object-fit: contain`; alt text "{company} logo". Arabic and English, phone width.

## Error Handling

PLT-07 messages (`FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `FILE_EMPTY`).

## Notifications

None.

## Audit Requirements

`company.logo.updated`, `company.logo.removed`, plus PLT-07's `file.uploaded` / `file.deleted`.

## Acceptance Criteria

- An administrator can upload, replace and remove the logo.
- The logo shows on the company's sign-in page and in the header; without one, the platform mark shows.
- Disallowed or oversized files are refused with a clear message.

## Test Scenarios

- **Positive:** upload PNG, JPEG, WebP; replace; remove.
- **Negative:** SVG; disguised PDF; 2 MB + 1 byte; non-administrator; logo of another company.

## Future Improvements

Logo on PDF reports (Sprint 18); separate logos for light and dark backgrounds; automatic resizing.
