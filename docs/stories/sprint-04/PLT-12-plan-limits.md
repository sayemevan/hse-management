# PLT-12 — Plan-Limit Enforcement

| Field    | Value                                                     |
| -------- | --------------------------------------------------------- |
| Epic     | Platform / tenancy                                        |
| Priority | Must                                                      |
| Status   | Approved                                                  |
| Sources  | Doc 08 §5; D-17, D-27, D-28; O-26; T-19, T-29; O-34, O-41 |

## Business Goal

Each plan gives what it promises — users, projects, storage — and no more, so plans are fair and upgrades are meaningful.

## Description

One service in the subscription module answers "can this company add N more users / projects / bytes?". It replaces the Sprint 3 seat check, adds the storage quota to every upload, and is ready for project creation in Sprint 5.

## Actors

Company Administrator and any user who uploads files; the system.

## Preconditions

PLT-06 (plan limits as data), PLT-07 (storage counted per company).

## Functional Requirements

The system shall:

1. Provide `PlanLimitService.assertCanAdd(companyId, resource, amount)` with `resource` in `users`, `projects`, `storage`, and `usage(companyId)` → `{ users, projects, storageBytes }` with limits.
2. Read each limit from the company's **current** plan (the plan of a confirmed future period applies when that period starts, PLT-10). `NULL` = unlimited.
3. Get the counts from the modules that own them, through their public contracts: seats from identity (`UserCounter`, O-26 rule), storage from the file service (sum of `size_bytes` of files not deleted), projects from the project module (Sprint 5; 0 until then).
4. **Users:** the invitation check (US-006) calls this service instead of its own query. Same rule and error as today.
5. **Storage:** before an upload is stored, refuse it if `used + file size > max_storage_bytes`. The check runs after the size and type checks and before writing to R2.
6. **Projects:** expose the check; Sprint 5 calls it before creating a project.
7. Refuse with `409 PLAN_LIMIT_REACHED`, `details: { resource, limit, used }` (`PLAN_USER_LIMIT_REACHED` stays as an alias for one sprint, so the web app can switch over).
8. Never remove or block existing data over the limit (O-41). Only adding more is refused.
9. When a Company Administrator picks a smaller plan for a payment (PLT-13, O-34), check current usage against the new plan and say which limit is over.

## Validation Rules

`amount` is a positive integer.

## Permission Rules

None of its own; it runs inside actions that are already permission-checked.

## Database Impact

None (reads `plan`, `subscription`; counts come from existing tables). An index on `file(company_id, deleted_at)` if the existing one doesn't cover the sum.

## API Requirements

No new endpoint. `POST /users/invitations`, `PUT /company/logo` and every future upload may return `409 PLAN_LIMIT_REACHED`. Usage is returned by `GET /subscription` (PLT-13).

## UI Requirements

- The users page shows "{used} of {limit} users" and, at the limit, disables **Invite** with "Your plan's user limit is reached. Upgrade the plan to add more."
- Upload controls show "Storage is full for your plan" on the error.
- Messages in Arabic and English; sizes formatted with Western digits (O-10).

## Error Handling

`PLAN_LIMIT_REACHED` with a message per resource ("Your plan allows {limit} users", "…{limit} projects", "Not enough storage left: {free} free").

## Notifications

None.

## Audit Requirements

Refusals aren't audited (no change); logged at `info`.

## Acceptance Criteria

- A Basic company with 25 seats can't invite a 26th user.
- An upload that would pass 5 GB on Basic is refused; a smaller one is accepted.
- Enterprise users and projects are unlimited.
- Usage over the limit after a downgrade keeps all data and blocks only new additions.

## Test Scenarios

- **Positive:** usage per resource; exactly at the limit allowed (≤), one over refused; unlimited plan.
- **Negative:** upload over quota leaves no R2 object and no `file` row; invitation over the limit; deleted files don't count.

## Future Improvements

Per-module limits (for example forms per inspection template) if plans grow; warning emails at 80 % and 100 % of storage.
