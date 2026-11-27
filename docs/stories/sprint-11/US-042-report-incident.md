# US-042 — Report Incident

| Field    | Value                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 06 — Safety Event Engine (Doc 14; Doc 20 "Epic 05", O-156)                                                                                                                        |
| Priority | Must                                                                                                                                                                                   |
| Status   | Approved                                                                                                                                                                               |
| Sources  | Product Book Doc 11 §3, §5, §6, §8, §13, §14, Doc 20 "Event Reporting" (incident, accident, environmental event); Doc 09 §10; D-11; T-85, T-90, T-92; O-159, O-162–O-164, O-173, O-175 |

## Business Goal

When something has happened — an injury, damage, a spill — the safety team must know at once, with the facts, and injury details must reach only those who need them (Doc 11 §14 "Critical events should trigger immediate notifications"; Doc 09 §10).

## User Story

As a **Foreman** (or anyone on the project), I want to report an incident with who was hurt, what was damaged or released and what we did, even offline, so that the safety team responds and investigates.

## Description

The **Incident** button of the Report screen (US-040) lists the incident-family types (seeded: Property Damage, Environmental Event, First Aid Case, Medical Treatment Case, Lost Time Injury, Fatality). The form adds, depending on the type's rules (O-164):

| Section                        | Shown when                                            | Fields                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **People injured or involved** | type has injury details                               | per person: workforce member / user / name; role Injured or Involved; for Injured: nature of injury, body part, treatment (None, First aid, Medical treatment, Hospitalised), days lost (optional), detail ≤ 1,000 (O-173) |
| **Damage**                     | every incident type                                   | what was damaged (≤ 2,000), optional                                                                                                                                                                                       |
| **Environment**                | every incident type; required for Environmental Event | what was released or affected, how much, contained? (≤ 2,000)                                                                                                                                                              |
| **Immediate action taken**     | always                                                | first aid given, area made safe, emergency services called (≤ 2,000)                                                                                                                                                       |
| **Medical documents**          | type has injury details; online only                  | up to 10 files (`safety_event_sensitive`, O-162)                                                                                                                                                                           |

Severity is the **actual outcome** (O-166); the type's minimum applies (Medical Treatment Case ≥ Medium, Lost Time Injury ≥ High, Fatality = Critical). Before **Send report**, a High or Critical incident shows: "The HSE team will be alerted now. For an emergency, call your emergency number first."

The **People** section is sensitive (T-92): after sending, only the investigation team and holders of `projects.safety_events.sensitive.view` see it; the reporter sees what they entered until review starts, then "2 people recorded".

Offline the whole form works except medical documents ("Add medical documents when you're back online"); people's details are stored on the device until synced (O-163).

## Actors

Every holder of `projects.safety_events.report`; HSE leads receiving the alert.

## Preconditions

As US-040.

## User Flow

1. **Report** → **Incident** → **First Aid Case**.
2. Title "Hand cut while cutting conduit"; injured: picks "Ahmed Saleh (Workforce)", Cut, Hand, First aid; immediate action "Cleaned and dressed by the first-aider"; **Low**; one photo of the tool.
3. **Send report** → number; the project's managers are notified.
4. Variant: **Lost Time Injury**, severity forced to at least **High** → on arrival HSE Directors and HSE Managers get `safety_event.high_reported`.

## Functional Requirements

The system shall:

1. Accept `people`, `damageDetails`, `environmentDetails` on the report for incident-family types; refuse injury fields for types without injury details (`422 VALIDATION_FAILED`).
2. Require at least one Injured person for types with injury details (First Aid Case, Medical Treatment Case, Lost Time Injury, Fatality) and the environment details for Environmental Event.
3. Store people in `safety_event_person`; strip them from every response and history entry for audiences without access (T-92, T-93).
4. Serve medical documents only through `GET …/safety-events/{id}/files/{fileId}` to the Sensitive and Team audiences; the generic file route answers `404` (T-49).
5. Write the severity notification in the report's batch (O-175); for Critical, mark it urgent.
6. Apply everything else of US-040.

## Validation Rules

As US-040, plus O-173 lists; days lost 0–365 integer; up to 20 people (`422 SAFETY_EVENT_PERSON_LIMIT`); a person linked to a workforce member or user of the company (`422 VALIDATION_FAILED` otherwise); medical documents PDF, JPEG, PNG ≤ 10 MB, 10 per event.

## Permission Rules

Reporting as US-040. People: written by the reporter at report (and until review starts), then by the Team and `.manage` + `sensitive.view` holders (US-044); read by Team and Sensitive audiences.

## Database Impact

`safety_event_person`: `id`, `company_id`, `event_id`, `workforce_member_id` / `user_id` / `name`, `role` (`injured`, `involved`), `injury_nature`, `body_part`, `treatment`, `days_lost`, `detail`, audit columns, `version`. No delete (removed rows soft-removed with reason, audited).

## API Requirements

- ⚡ `POST /api/v1/projects/{projectId}/safety-events` with `people[]`, `damageDetails?`, `environmentDetails?`.
- `GET`, `PUT …/safety-events/{id}/people` (whole list, `baseVersion`) — online, Team / Sensitive writers.
- `POST …/safety-events/{id}/files` with `category: sensitive` (online).

## UI Requirements

- People as cards ("Injured · Hand · First aid"), add with a sheet; lists as pickers with words in both languages.
- A lock icon and "Visible to the investigation team and HSE leads only" on the People and Medical documents sections.
- The pre-send alert for High and Critical uses an icon and text.

## Error Handling

As US-040, plus: missing injured person → `422 VALIDATION_FAILED` (`people`); too many people → `422 SAFETY_EVENT_PERSON_LIMIT`; medical document offline → not offered.

## Notifications

`safety_event.reported` / `.high_reported` / `.critical_reported` (urgent) by severity; parameters never include names or injuries.

## Audit Requirements

As US-040; `safety_event.person_changed` (counts and roles only); `safety_event.file_added` with `category: sensitive` (no file name in the summary).

## Acceptance Criteria

- A Lost Time Injury reported Medium is refused; reported High it alerts the HSE Directors and HSE Managers in the same batch.
- A Fatality report sends `safety_event.critical_reported` (urgent) to Company Administrators too.
- A Client and a Site Engineer not on the team see the incident without people's details or medical documents; the Safety Officer sees them.
- An incident with an injured person reported offline syncs with the person; the device copy is pruned after sync.

## Test Scenarios

- **Positive:** each incident type; people with workforce links and names; environmental details; offline report with people; sensitive filtering for each audience.
- **Negative:** injured person missing; injury fields on Property Damage; days lost out of range; medical document by a viewer; generic file route for a sensitive file → 404.

## Future Improvements

Body-map picker; regulatory notification deadlines; return-to-work tracking; link to the workforce member's medical fitness (Sprint 7) after a Lost Time Injury.
