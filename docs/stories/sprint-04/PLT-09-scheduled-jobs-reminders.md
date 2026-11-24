# PLT-09 — Scheduled Jobs & Reminder Core

| Field    | Value                                                                         |
| -------- | ----------------------------------------------------------------------------- |
| Epic     | Platform / services                                                           |
| Priority | Must                                                                          |
| Status   | Approved                                                                      |
| Sources  | Product Book Doc 31 (Reminder System), Master Rules §6; D-18; T-9, T-25, T-26 |

## Business Goal

Deadline-driven work (trial expiry, renewals, later permit and certificate expiry) runs every day without anyone pressing a button, and each reminder reaches people exactly once.

## Description

The Worker's daily cron runs a list of named jobs. Each job runs on its own, is recorded in `job_run`, and can't stop the others. A reminder helper lets a job send a templated email to a set of users once per unique key. Sprint 4's subscription job (PLT-10) is the first user; Sprints 8, 13 and 19 reuse it.

## Actors

The system (cron); System Owner (views job history).

## Preconditions

PLT-05 email service (outbox and queue).

## Functional Requirements

The system shall:

1. Keep a **job registry**: each daily job has a unique name and a function `run(context) → { processed, changed, failed }`.
2. Run the registered jobs in order on the daily cron (`0 3 * * *`, 06:00 Riyadh). Each job runs in its own `try/catch`; a failure is logged with the error and the next job still runs.
3. Record every run in `job_run` (name, start, end, outcome `succeeded` / `failed`, counts, short error message) and delete rows older than 90 days.
4. Move the existing daily housekeeping into the registry as separate jobs: `sessions.purge`, `files.purge`, `registrations.maintenance`.
5. Provide `ReminderService.sendOnce(key, recipients, template, data)`: in one batch, insert the `reminder_log` row and the outbox emails; if the key already exists, do nothing and report it as skipped.
6. Let a job be run **by hand in development** (`npm run job:run -- <name> [--now <ISO date>]`), using the same code and a chosen clock, for testing and the browser check.
7. Show the last run of each job to the System Owner: `GET /platform/jobs` → `[{ name, lastRunAt, outcome, processed, changed, failed, error }]`.

## Validation Rules

- Job names are unique; registering the same name twice fails at start-up.
- Reminder keys are at most 200 characters.
- `--now` is accepted only when `APP_ENV` is `development` or `test`.

## Permission Rules

`GET /platform/jobs`: `platform.subscriptions.view` (System Owner). The cron needs no user; it acts as the `system` actor in audit entries.

## Database Impact

New table `job_run`:

| Column                           | Type        | Notes                     |
| -------------------------------- | ----------- | ------------------------- |
| `id`                             | TEXT (UUID) | PK                        |
| `job_name`                       | TEXT        | indexed with `started_at` |
| `started_at`, `finished_at`      | INTEGER     | UTC ms                    |
| `outcome`                        | TEXT        | `succeeded`, `failed`     |
| `processed`, `changed`, `failed` | INTEGER     |                           |
| `error`                          | TEXT        | nullable, max 500 chars   |

New table `reminder_log`:

| Column       | Type        | Notes                                  |
| ------------ | ----------- | -------------------------------------- |
| `id`         | TEXT (UUID) | PK                                     |
| `key`        | TEXT        | unique                                 |
| `company_id` | TEXT        | nullable (platform reminders), indexed |
| `template`   | TEXT        |                                        |
| `sent_at`    | INTEGER     | UTC ms                                 |

Neither table has audit columns: rows are written once by the system and never edited.

## API Requirements

`GET /api/v1/platform/jobs` (above).

## UI Requirements

None in this sprint beyond the API (a jobs card on the System Owner console can come with Administration). The subscriptions overview (PLT-14) shows "Last checked: {time}" from the `subscriptions.lifecycle` job.

## Error Handling

- A job that throws is recorded as `failed` with the message; other jobs run.
- A database error while writing `job_run` is logged and doesn't hide the job's own result in the logs.
- Duplicate reminder key → skipped, not an error.

## Notifications

None of its own; it is the mechanism for PLT-15.

## Audit Requirements

Jobs don't audit their runs (`job_run` is the record). The changes they make are audited by their own module (for example `subscription.read_only_started`, PLT-10) with actor `system`.

## Acceptance Criteria

- The daily cron runs all registered jobs and writes one `job_run` row per job.
- A job that throws doesn't stop the others and is shown as failed.
- Calling `sendOnce` twice with the same key sends one email.
- Session, file and registration housekeeping still work as before.

## Test Scenarios

- **Positive:** three jobs run in order; job history returned; reminder sent once with recipients in two languages.
- **Negative:** a throwing job; a duplicate key; a duplicate job name at start-up; `--now` refused outside development.

## Future Improvements

Hourly jobs for time-critical reminders (permits, Sprint 13); a jobs page with a "run now" button for the System Owner (Sprint 19); in-app reminders alongside email (Sprint 6).
