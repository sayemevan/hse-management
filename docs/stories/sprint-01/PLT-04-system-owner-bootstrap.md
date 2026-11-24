# PLT-04 — System Owner Bootstrap

| Field    | Value                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security (enabler)                                                             |
| Priority | Must                                                                                                      |
| Status   | Approved                                                                                                  |
| Sources  | D-02 (System Owner = Super Admin), D-06 (System Owner verifies companies); Product Book Doc 06 §2, Doc 07 |

## Business Goal

The very first account must exist before anyone can sign in. The System Owner runs the platform and later approves company registrations (D-06).

## Description

A one-time operator command creates the first System Owner. It is not a web page or a public API, so it can't be abused from the internet.

## Actors

Platform operator (a person with deployment access).

## Preconditions

Database migrated; no System Owner exists yet.

## User Flow

1. The operator runs `npm run bootstrap:system-owner --workspace @hse/api -- --env <environment>`.
2. The command asks for email, full name and password (password typed hidden, entered twice).
3. It creates the user with the System Owner role at platform scope and prints a confirmation.

## Functional Requirements

The command shall:

1. Refuse to run if a System Owner already exists, unless `--add` is passed explicitly.
2. Apply the same password policy as everywhere else (D-03).
3. Never read the password from command-line arguments, environment files or the repository.
4. Create the `user` (status Active) and a `user_role` row (role System Owner, scope platform) in one atomic batch, with an audit record (`platform.system_owner.created`).

## Validation Rules

Valid email; full name required; password per D-03.

## Permission Rules

Only someone with deployment credentials for the environment can run it.

## Database Impact

New table `user_role`:

| Column                      | Type              | Notes                                           |
| --------------------------- | ----------------- | ----------------------------------------------- |
| `id`                        | TEXT (UUID)       | PK                                              |
| `user_id`                   | TEXT              | FK → `user`                                     |
| `role_code`                 | TEXT              | one of the 14 roles (D-02), e.g. `system_owner` |
| `scope_level`               | TEXT              | `platform`, `company`, `project`                |
| `company_id`, `project_id`  | TEXT, nullable    | as required by the scope                        |
| `valid_from`, `valid_until` | INTEGER, nullable | supports temporary access later (Doc 07 §12)    |
| audit columns               |                   | standard                                        |

The full role catalogue and permissions arrive in Sprint 5; Sprint 1 only needs `system_owner`.

## API Requirements

None (command-line only).

## UI Requirements

None.

## Error Handling

Clear terminal messages for invalid input, an existing System Owner, or no database connection.

## Notifications

None.

## Audit Requirements

`platform.system_owner.created`, with the actor recorded as "system (bootstrap)".

## Acceptance Criteria

- On an empty database the command creates exactly one System Owner, who can sign in on the base domain.
- A second run without `--add` is refused.
- A weak password is rejected.

## Test Scenarios

- **Positive:** first run; `--add` for a second owner.
- **Negative:** repeat run; weak password; mismatched confirmation.

## Future Improvements

Managing platform staff from the platform console.
