# PLT-07 — File Storage Service v1 (R2)

| Field    | Value                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Epic     | Platform enabler                                                                                                 |
| Priority | Must                                                                                                             |
| Status   | Approved                                                                                                         |
| Sources  | Product Book Doc 01 §7, Doc 02 §8; Master Rules §5 and MASTER_RULES_04 (File Management); D-28; O-11; T-18, T-19 |

## Business Goal

Give every module one safe way to store and serve files (Master Rules §5: "Never implement multiple upload systems"). The company logo is the first user; payment proofs (Sprint 4), inspection photos (Sprint 10) and documents (Sprint 17) follow.

## Description

A platform service that accepts an uploaded file, checks it, stores it in R2 and records its metadata in D1. Files are private: they are read only through the API, which checks the tenant and the caller's access.

## Actors

Modules (not end users directly). Indirectly every user who uploads or views a file.

## Preconditions

The `FILES` R2 binding exists (already in `wrangler.jsonc`).

## Functional Requirements

The service shall:

1. Expose `store({ companyId, category, uploadedBy, file })` and `open(fileId, caller)`, plus `remove(fileId)` (soft delete; the R2 object is removed by the daily housekeeping job after 30 days).
2. Use **categories** with their own rules (allowed types, max size, who may read). Sprint 3 defines one category, `company_logo` (O-30: PNG, JPEG, WebP; 2 MB; readable publicly for the company's sign-in page).
3. Detect the type from the file's first bytes (magic bytes) and reject a file whose content doesn't match an allowed type, whatever its name or declared type.
4. Store objects under a generated key `companies/<companyId>/<category>/<fileId>`; the original file name is kept only as metadata (Doc 02 §8: unique file names).
5. Record `size_bytes` and a SHA-256 checksum, and keep a per-company total so Sprint 4 can enforce D-28 quotas without a back-fill (T-19).
6. Serve files with the stored content type, `Content-Disposition` with a safe file name, `X-Content-Type-Options: nosniff`, and a cache header suited to the category.
7. Never let one company read another company's file: `open` compares the file's `company_id` with the request's tenant before anything else.

## Validation Rules

- Empty files are rejected.
- Size is checked while reading, so an oversized upload stops early.
- File names are limited to 200 characters and cleaned of path separators and control characters.

## Permission Rules

Decided per category. `company_logo`: anyone may read the company's current logo; only a Company Administrator may change it (US-014).

## Database Impact

New table `file`:

| Column         | Type    | Notes                                 |
| -------------- | ------- | ------------------------------------- |
| `id`           | TEXT PK | UUID v7                               |
| `company_id`   | TEXT FK | `company.id`; null for platform files |
| `category`     | TEXT    | e.g. `company_logo`                   |
| `storage_key`  | TEXT    | R2 key, unique                        |
| `file_name`    | TEXT    | cleaned original name                 |
| `content_type` | TEXT    | detected type                         |
| `size_bytes`   | INTEGER |                                       |
| `checksum`     | TEXT    | SHA-256 hex                           |
| audit columns  |         | `created_at`, `created_by`, …         |
| `deleted_at`   | INTEGER | soft delete                           |

Index on `(company_id, category)`.

## API Requirements

`GET /api/v1/files/{id}`: streams the file if the caller may read it, else `404` (never `403`, so file ids can't be probed). Uploads are done by each module's own endpoint (for example `PUT /company/logo`), which calls the service.

## UI Requirements

A shared `FileDropzone` component: choose or drop a file, shows the allowed types and size before upload, a progress state, and the error from the server. Works with a keyboard and a screen reader.

## Error Handling

| Code                    | Message                                              |
| ----------------------- | ---------------------------------------------------- |
| `FILE_TOO_LARGE`        | "This file is larger than {max} MB."                 |
| `FILE_TYPE_NOT_ALLOWED` | "This type of file isn't allowed here. Use {types}." |
| `FILE_EMPTY`            | "This file is empty."                                |

## Notifications

None.

## Audit Requirements

`file.uploaded` and `file.deleted` (file id, category, size; never the content).

## Acceptance Criteria

- An allowed file is stored in R2 and its metadata in D1, and can be read back byte for byte.
- A file renamed to `.png` but containing something else is rejected.
- An oversized file is rejected without being stored.
- A file of company A can't be read from company B's subdomain, even with its id.

## Test Scenarios

- **Positive:** PNG, JPEG, WebP logo; read back; soft delete then 404.
- **Negative:** PDF renamed `.png`; SVG; 2 MB + 1 byte; empty file; other company's file id; unknown id.
- **Boundary:** exactly 2 MB accepted.

## Future Improvements

Presigned direct uploads for large files; image resizing and thumbnails (inspection photos); virus scanning; version history (MASTER_RULES_04).
