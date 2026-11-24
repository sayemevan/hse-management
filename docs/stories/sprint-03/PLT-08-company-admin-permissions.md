# PLT-08 — Company Administration Permissions (temporary)

| Field    | Value                                                                       |
| -------- | --------------------------------------------------------------------------- |
| Epic     | Platform enabler                                                            |
| Priority | Must                                                                        |
| Status   | Approved                                                                    |
| Sources  | Product Book Doc 07 §2, §7, §18; Master Rules (deny by default); T-14, T-20 |

## Business Goal

Protect the new company-administration endpoints now, without waiting for the full permission matrix (US-008, US-009, Sprint 5).

## Description

Extends the Sprint 2 temporary checker (T-14). It grants a fixed list of company permissions to users who hold the `company_administrator` role in that company. Everything else is denied. Sprint 5 replaces the checker with the matrix; routes keep calling `requirePermission()` with the same permission names.

## Actors

Company Administrator; the System Owner checker stays as it is.

## Preconditions

Sprint 2 `systemOwnerPermissionChecker` and `requirePermission()` exist.

## Functional Requirements

The system shall:

1. Define the Sprint 3 company permissions: `users.view`, `users.invite`, `company.view`, `company.edit`, `company.settings.edit`, `company.logo.edit`.
2. Grant them at **company scope** to a user with an active `company_administrator` role whose `company_id` equals the scope's company, and only while the user and the company are `active` or `read_only` for view permissions.
3. Grant `company.view` to every active user of the company (the information page, US-015).
4. Deny everything else, including any permission at another company's scope.
5. Keep the permission names in one registry, so Sprint 5 can seed them into the matrix unchanged.

## Validation Rules

None (no input).

## Permission Rules

This item defines them.

## Database Impact

None. Reads `user_role`.

## API Requirements

A `requireCompanyPermission(permission)` guard, the company counterpart of `requirePlatformPermission`. The scope is always the request's tenant, never a company id sent by the client.

## UI Requirements

The app hides menu entries the user can't use, based on a `permissions` list returned by `GET /auth/me`. The server check remains the real protection (Doc 07 §18).

## Error Handling

`403 FORBIDDEN`: "You don't have permission to do this." (existing message).

## Notifications

None.

## Audit Requirements

None beyond the existing "permission denied" log line.

## Acceptance Criteria

- A Company Administrator of company A can call the Sprint 3 admin endpoints on A's subdomain.
- The same user is refused on company B's subdomain.
- A user with any other role is refused admin endpoints but can read the company information.
- The System Owner is refused company endpoints (platform scope only).

## Test Scenarios

- **Positive:** administrator on own company; ordinary user reads company information.
- **Negative:** administrator on another company; ordinary user edits company; expired role (`valid_until` in the past); suspended user.

## Future Improvements

Replaced by the permission matrix in Sprint 5.
