# PLT-02 — Tenant Resolution from Subdomain

| Field    | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Epic     | Platform / Company (Epic 02 dependency)                                    |
| Priority | Must                                                                       |
| Status   | Approved                                                                   |
| Sources  | D-06, D-16 (PO decisions); Product Book Doc 01 §9, Doc 04 §14, Doc 06 §2–3 |

## Business Goal

Each company works on its own subdomain (D-06), and company data stays strictly isolated (Doc 01 §9: "Data isolation between companies is mandatory").

## Description

Every request is tied to exactly one context: a **company** (on `<slug>.<base-domain>`) or the **platform** (on the base domain itself). The context is resolved once per request and every later layer uses it. Repositories receive it and always filter by it.

## Actors

All users; System Owner (platform context).

## Preconditions

- The base domain is configured (F-01a). Until it is known, development uses `<slug>.localhost`.
- A minimal `company` table exists (created by this spec, extended in Sprint 2).

## User Flow

1. User opens `acme.<base-domain>`.
2. The web app asks the API for the tenant's public profile (`GET /tenant`).
3. The login page shows the company's name, logo and default language.
4. Every later API call carries the company context; the API rejects any attempt to reach another company's data.

## Functional Requirements

The system shall:

1. Determine the context from the request host. The web app forwards the original host to the API in a header (`x-tenant-host`), which the API accepts only from allowed origins.
2. Treat the base domain (and `www`) as the **platform** context, a valid active slug as that **company**, and anything else as unknown.
3. Return "Company not found" for unknown slugs and for companies that aren't active, without revealing which of those applies.
4. Check that an authenticated user belongs to the resolved company (D-08: one company per user). A token issued on one subdomain is rejected on another.
5. Cache slug lookups in KV for at most 5 minutes; changing a company's status clears the cache entry.

## Validation Rules

- Slug format per D-16: 3–30 characters, lowercase letters, digits and hyphens, not starting or ending with a hyphen.
- Reserved slugs (`www`, `admin`, `api`, `app`, `mail`) never resolve to a company.

## Permission Rules

- `GET /tenant` is public and returns only name, logo URL and default language.
- All other data access requires a matching company (or the platform context for the System Owner).

## Database Impact

New table `company` (minimal; Sprint 2 adds registration, plan and verification fields):

| Column             | Type           | Notes                                                                                                             |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`               | TEXT (UUID)    | PK                                                                                                                |
| `name`             | TEXT           |                                                                                                                   |
| `slug`             | TEXT           | unique, case-insensitive                                                                                          |
| `status`           | TEXT           | `pending_verification`, `active`, `read_only`, `suspended` (subscription states from D-18 are used from Sprint 4) |
| `default_language` | TEXT           | `en` or `ar`                                                                                                      |
| `logo_file_id`     | TEXT, nullable | file storage arrives in Sprint 2                                                                                  |
| audit columns      |                | standard                                                                                                          |

## API Requirements

`GET /api/v1/tenant` → `{ context: 'platform' | 'company', company?: { name, logoUrl, defaultLanguage } }`

## UI Requirements

- Unknown or inactive subdomain: a page saying "This company address was not found" with a link to the platform home.
- The company name and logo appear on the login page.

## Error Handling

- Unknown company: 404 with a friendly message.
- Wrong company for the signed-in user: 403 "You do not have access to this company."

## Notifications

None.

## Audit Requirements

Cross-company access attempts are audited (`tenant.access.denied`).

## Acceptance Criteria

- `acme.localhost` resolves to company Acme; `localhost` resolves to the platform.
- Reserved and malformed slugs never resolve.
- A user of company A who sends their token to company B's subdomain receives 403, and the attempt is audited.
- Repositories cannot be called without a tenant context (enforced by their method signatures).

## Test Scenarios

- **Positive:** active slug; platform host.
- **Negative:** unknown slug; inactive company; reserved slug; spoofed `x-tenant-host` from a disallowed origin; token reused across subdomains.
- **Boundary:** 3- and 30-character slugs; 2- and 31-character slugs rejected.

## Future Improvements

Custom domains per company (D-06, later phase); per-tenant data residency.
