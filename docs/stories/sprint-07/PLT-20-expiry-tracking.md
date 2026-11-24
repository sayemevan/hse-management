# PLT-20 — Expiry Tracking, Compliance Summary and Expiry Reminders

| Field    | Value                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Certificates: Expiry Tracking, Renewal Reminder", "Medical Expiry")                           |
| Priority | Must                                                                                                                                  |
| Status   | Approved                                                                                                                              |
| Sources  | Doc 09 §8–12, §14, §15, §17; Doc 18 Business Rules; Master Rules 03 "Notification" (Expiry); T-40, T-41, T-50, T-51; O-83, O-84, O-94 |

## Business Goal

Expired training, certificates, medical clearances and permits to work are among the most common audit findings on construction sites. The safety team must see **before** something expires, and expired items must be "clearly identified" (Doc 09 §17).

## User Story

As an **HSE Manager or Safety Officer**, I want to see who has expired or expiring records and get one daily reminder, so that I can arrange renewals before people are stopped from working.

## Description

This enabler gives every dated workforce record the same expiry rules and display, a **compliance summary** per person, a **Needs attention** filter, the directory counts, and the daily reminder job. The expiry function is shared and will be reused by equipment, permits and documents in later sprints (T-50).

**Expiry state** (`expiryState(expiresOn, today)`; `today` = calendar date in the company's time zone):

| State      | Rule                                   | Shown as                                             |
| ---------- | -------------------------------------- | ---------------------------------------------------- |
| `none`     | no expiry date                         | "No expiry"                                          |
| `valid`    | more than 30 days left                 | "Valid until 12 Mar 2027"                            |
| `expiring` | 0–30 days left (the expiry day counts) | "Expires in 12 days" / "Expires today", warning icon |
| `expired`  | the date has passed                    | "Expired 3 days ago", error icon                     |

A record is **current** when it isn't voided and hasn't been replaced (T-48). Only current records count in summaries and reminders.

**Compliance summary per person** (returned with the profile, directory rows and project workforce rows):

- `worst`: the worst state among current training, certificates, medical and (for readers with `workforce.personal.view`) documents: `expired` > `expiring` > `ok`.
- Counts: expired, expiring.
- Flags: `medicalMissing` (no current medical record), `medicalUnfit` (current record is Unfit), `noEmergencyContact` (readers with `workforce.contacts.view` only).
- Badge: **OK**, **Expiring**, **Expired** or **Check** (missing medical, unfit or no emergency contact). Status is never shown by colour alone (icon + text).

## Actors

Holders of `workforce.view` (summary and filter); holders of `workforce.manage` and `projects.workforce.manage` (reminders, O-84); linked users (own reminders, O-85); the daily job.

## Preconditions

- Records exist with expiry dates (US-026–028, US-030); assignments with end dates (US-025).

## User Flow

1. Open **Workforce**. The top shows **Total**, **Active**, **Needs attention** counts.
2. Select **Needs attention** → the directory lists people whose badge isn't OK, worst first, then by the nearest expiry date.
3. Each row shows the badge and the nearest item, for example "Operator licence expires in 6 days".
4. Each morning, recipients get one notification: "6 workforce items need attention: 2 expired, 3 expiring, 1 assignment ending" → opens the directory with **Needs attention** on (or the project's Workforce tab, for project-only recipients).

## Functional Requirements

The system shall:

1. Provide `expiryState` and the 30-day window in the shared package, used by the API and the web app alike.
2. Compute the compliance summary per person from current records on every read (no stored status), with at most one query per record table for a page of 25 people.
3. Offer `attention=true` on the directory and project workforce lists: people with an expired or expiring current record, a missing or unfit medical, or (for readers with contact access) no emergency contact.
4. Return `GET /workforce/summary` → `{ total, active, needsAttention }` for profiles that aren't archived.
5. Run the daily job **`workforce.expiry`** (in `src/jobs.ts`) for every active company, including read-only ones (reminders still help while they renew), finding:
   - current records whose expiry date is 30 days ahead, 7 days ahead, or today;
   - current and upcoming assignments ending in 7 days.
6. Send each item and threshold **once** (`ReminderService` key `workforce:{table}:{recordId}:{30|7|0}`); an item first found late (for example the job missed a day) is sent at the nearest threshold not yet sent.
7. Group the day's items into **one digest notification per recipient** (O-84):
   - holders of `workforce.manage`: every item of the company;
   - holders of `projects.workforce.manage` on a project: items of people currently assigned there, and that project's ending assignments;
   - document and medical items only for recipients with `workforce.personal.view`;
   - nobody gets a digest with zero items; the actor rule doesn't apply (system event).
8. Send the **linked user** a personal notification per item about their own records ("Your Operator licence expires in 7 days").
9. Skip archived profiles, voided and replaced records, and people whose status is Terminated or Inactive.

## Validation Rules

| Field       | Rule                                                      | Message                                         |
| ----------- | --------------------------------------------------------- | ----------------------------------------------- |
| Expiry date | A valid calendar date, after the issue or completion date | "The expiry date must be after the issue date." |

## Permission Rules

- `workforce.view` (company) for the summary, counts and the filter.
- Digest recipients by O-84. No new permission.

## Database Impact

No new table. Indexes on `expires_on` (with `company_id`) on `workforce_training`, `workforce_certificate`, `workforce_medical`, `workforce_document`, and on `end_date` of `workforce_assignment`. Reminder keys in the existing `reminder` table.

## API Requirements

- `GET /api/v1/workforce/summary` → `{ total, active, needsAttention }`.
- `attention=true` on `GET /workforce` and `GET /projects/{projectId}/workforce`.
- Every dated record in responses carries `expiresOn` and `expiryState`; every person row carries `compliance: { badge, worst, expired, expiring, medicalMissing, medicalUnfit, noEmergencyContact?, nearest: { kind, name, expiresOn } | null }`.

## UI Requirements

- One shared **Expiry badge** component (web) used on every record list and later modules.
- Dates in `<bdi dir="ltr">`; relative wording ("in 12 days") in the reader's language.
- Counts as tiles above the directory; the **Needs attention** tile toggles the filter.

## Error Handling

| Case          | Response                               |
| ------------- | -------------------------------------- |
| No permission | `403 FORBIDDEN`                        |
| Job failure   | Logged; the next run catches up (FR-6) |

## Notifications

| Type                         | To              | Text                                                                                                          |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `workforce.attention.digest` | O-84 recipients | "{count} workforce items need attention: {expired} expired, {expiring} expiring, {ending} assignments ending" |
| `workforce.record.expiring`  | linked user     | "Your {record} expires in {days} days" / "expires today"                                                      |

## Audit Requirements

None for reads and reminders (the reminder table records what was sent).

## Acceptance Criteria

- A certificate expiring in 30 days shows "Expiring"; in 31 days shows "Valid until …"; yesterday shows "Expired".
- At 23:30 in Riyadh on the expiry day the record shows "Expires today", whatever the server's time zone.
- The job sends the 30-day reminder once even if run twice; a renewed certificate gets no more reminders for the replaced one.
- A Safety Officer without `workforce.personal.view` gets a digest that doesn't count Iqama expiries.
- A Project Manager on RMX-02 only gets items about people assigned to RMX-02.

## Test Scenarios

- **Positive:** state boundaries; summary counts; attention filter; digest grouping per recipient; linked user notices; catch-up after a missed day.
- **Negative:** voided and replaced records ignored; archived and terminated people ignored; no digest when nothing is due; no personal items for readers without the permission; another company's data never included.

## Future Improvements

Company-configurable warning window; weekly digest option and email copies (Sprint 19); the same badge for equipment and permits; dashboard tiles (Sprint 18).
