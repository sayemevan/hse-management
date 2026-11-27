# US-041 — Report Near Miss

| Field    | Value                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Epic     | Epic 06 — Safety Event Engine (Doc 14; Doc 20 "Epic 05", O-156)                                              |
| Priority | Must                                                                                                         |
| Status   | Approved                                                                                                     |
| Sources  | Product Book Doc 14, Doc 11 §1–6, §8, Doc 20 "Event Reporting"; D-11; T-85, T-90; O-159, O-163, O-164, O-166 |

## Business Goal

A near miss is an incident that didn't hurt anyone this time. Recording what could have happened lets the safety team act before it does (Doc 11 §1 "Record near misses").

## User Story

As a **Supervisor** (or anyone on the project), I want to report a near miss with what happened and how bad it could have been, even offline, so that it is reviewed and investigated when it could have been serious.

## Description

The **Near miss** button of the Report screen (US-040) opens the same form with the near-miss section:

| Field                                                          | Rule                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Title, description, where, when, categories, photos, witnesses | as US-040 ("What happened?")                                                                                           |
| What could have happened?                                      | **worst credible outcome**, required, 10–1,000 characters ("The bundle could have hit the rigger below")               |
| How serious could it have been?                                | proposed severity, required, from the worst credible outcome (O-166)                                                   |
| People involved                                                | optional names or workforce links of the people who were nearly hurt (role "Involved", no injury fields, US-042 table) |
| What did you do about it?                                      | immediate action taken, optional                                                                                       |

The screen explains under the severity: "A near miss that could have caused a serious injury is investigated." — the O-159 rule (High or Critical → investigation required for `by_severity` types, the near-miss default).

Everything else — offline, number, drafts, reporter edits before review, notifications — is US-040.

## Actors

Every holder of `projects.safety_events.report`.

## Preconditions

As US-040.

## User Flow

1. **Report** → **Near miss**.
2. "A sling slipped while lifting rebar; the load dropped 1 m next to a worker." · Could have happened: "Struck by load — serious injury." · **High** · one photo of the sling.
3. **Send report** → number, or "Saved on this device" offline.
4. The reviewer confirms High → the event page shows "Investigation required" (US-043).

## Functional Requirements

The system shall:

1. Store the worst credible outcome in `safety_event.potential_outcome` (required for the near-miss family, `422 VALIDATION_FAILED` otherwise).
2. Store involved people in `safety_event_person` with role `involved` (no injury fields accepted for near misses).
3. Apply everything else of US-040 FR-1 to FR-7.

## Validation Rules

As US-040, plus: potential outcome 10–1,000 characters; up to 20 involved people (name 2–120 or a workforce member / user of the company).

## Permission Rules

As US-040. Involved people's names are part of the **sensitive** set (T-92): viewers see "2 people involved".

## Database Impact

`safety_event.potential_outcome` (text, nullable); `safety_event_person` (US-042).

## API Requirements

As US-040, with `potentialOutcome` and `people: [{ workforceMemberId? | userId? | name, role: 'involved' }]` on the report.

## UI Requirements

- The near-miss section is introduced by "Nobody was hurt — what could have happened?".
- People picker: search workforce members of the project (online; offline from the project pack's members) or type a name.

## Error Handling

As US-040; injury fields on a near miss → `422 VALIDATION_FAILED`; too many people → `422 SAFETY_EVENT_PERSON_LIMIT`.

## Notifications

As US-040 by proposed severity.

## Audit Requirements

As US-040; people changes as `safety_event.person_changed` (count only in the summary).

## Acceptance Criteria

- A near miss without a worst credible outcome is refused.
- A near miss reported High, confirmed High at review, can't move to Corrective Action without an investigation (`SAFETY_EVENT_INVESTIGATION_REQUIRED`).
- A Client viewing it sees "1 person involved" without the name.

## Test Scenarios

- **Positive:** report online and offline with involved people; reclassify as an incident at review (US-043) keeps the people.
- **Negative:** missing potential outcome; injury fields on a near miss; people limit; involved person of another company.

## Future Improvements

Near-miss frequency and "Heinrich pyramid" view on the dashboard (Doc 30); lessons-learned sharing across projects.
