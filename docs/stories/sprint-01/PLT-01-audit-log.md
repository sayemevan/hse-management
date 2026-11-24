# PLT-01 — Audit Log Service

| Field    | Value                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Epic     | Platform services (Epic 01 dependency)                                                                                         |
| Priority | Must                                                                                                                           |
| Status   | Approved                                                                                                                       |
| Sources  | Master Rules §9, MASTER_RULES_02 (Audit), ARCHITECTURE_RULES (shared services); Product Book Doc 01 §12, Doc 02 §9, Doc 07 §16 |

## Business Goal

"Nothing important should happen without an audit record" (Master Rules §9). One shared service records who did what, when, where, and what changed, so that every module is traceable from creation to closure.

## Description

A platform service that any module calls to append an audit record. Records can never be edited or deleted. This sprint uses it for authentication events; later modules use the same service for create, update, delete, approval and status changes.

## Actors

- Every module (as a caller of the service)
- System Owner and Auditor (as readers — the viewing screen comes with Administration, Sprint 19)

## Preconditions

None. It is the first service built.

## Functional Requirements

The service shall:

1. Expose one method, `record(event)`, used by all modules. There is no update or delete method.
2. Capture for every record (Doc 01 §12, MASTER_RULES_03 timeline): **who** (user id, or "system"), **what** (action and entity), **when** (UTC timestamp), **where** (company, project when applicable), **old value**, **new value**, plus request id, IP address, device and browser, and outcome (success or failure).
3. Support these action names in Sprint 1: `auth.login.succeeded`, `auth.login.failed`, `auth.account.locked`, `auth.logout`, `auth.session.revoked`, `auth.password.changed`, `auth.token.refreshed` (see O-9 below).
4. Write the audit record **in the same atomic batch** as the business change it describes, so neither can exist without the other (ADR-001: D1 batch).
5. Never store passwords, password hashes or tokens in `old_value` / `new_value`; sensitive fields are replaced with `[REDACTED]`.

## Validation Rules

- `action` must be a known action name (a registry in code; new modules register theirs).
- `entity_type` and `entity_id` are required except for authentication events with no entity.
- `old_value` / `new_value` are JSON objects; maximum stored size 32 KB each (larger values are truncated with a marker).

## Permission Rules

- Writing: only server code, through the service. There is no API to create audit records.
- Reading: no endpoint in Sprint 1.

## Database Impact

New table `audit_log`:

| Column                                   | Type                  | Notes                                                   |
| ---------------------------------------- | --------------------- | ------------------------------------------------------- |
| `id`                                     | TEXT (UUID)           | PK                                                      |
| `occurred_at`                            | INTEGER (UTC ms)      | indexed                                                 |
| `actor_user_id`                          | TEXT, nullable        | null = system                                           |
| `company_id`                             | TEXT, nullable        | null = platform-level event; indexed with `occurred_at` |
| `project_id`                             | TEXT, nullable        |                                                         |
| `action`                                 | TEXT                  | indexed                                                 |
| `entity_type`, `entity_id`               | TEXT, nullable        | indexed together                                        |
| `outcome`                                | TEXT                  | `success` / `failure`                                   |
| `old_value`, `new_value`                 | TEXT (JSON), nullable |                                                         |
| `request_id`, `ip_address`, `user_agent` | TEXT, nullable        |                                                         |

Immutability (T-5): triggers `audit_log_no_update` and `audit_log_no_delete` abort any `UPDATE` / `DELETE`. This table has **no** `updated_*` or `deleted_*` columns; it is the documented exception to the standard audit columns.

## API Requirements

None.

## UI Requirements

None.

## Error Handling

If writing the audit record fails, the business change in the same batch fails too, and the user sees a generic "Please try again" error. Audit failures are never silently ignored.

## Notifications

None.

## Audit Requirements

This is the audit service itself.

## Acceptance Criteria

- A login, failed login, lock, logout, session revocation and password change each produce exactly one audit record with all required fields.
- An attempt to `UPDATE` or `DELETE` an audit row through SQL fails.
- No audit record contains a password, hash or token.
- When the business write fails, no audit record is left behind, and when the audit write fails, the business change is rolled back.

## Test Scenarios

- **Positive:** record each Sprint 1 action and read it back.
- **Negative:** direct SQL update or delete is rejected; an unknown action name is rejected; a payload containing `password` is redacted.
- **Boundary:** a 40 KB `new_value` is truncated with a marker.

## Open point

- **O-9** Should token refreshes be audited? They are frequent (every ~15 minutes per active user). **Proposed: no** — the session's `last_activity_at` covers it; only failed refreshes (reuse of a revoked token) are audited.

## Future Improvements

Audit viewer with filters and export (Administration); retention policy (Q-37); hash-chaining records for tamper evidence.
