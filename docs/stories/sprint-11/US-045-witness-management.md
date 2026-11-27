# US-045 — Witness Management

| Field    | Value                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Epic     | Epic 06 — Safety Event Engine (Doc 14; Doc 20 "Epic 05", O-156)                                       |
| Priority | Must                                                                                                  |
| Status   | Approved                                                                                              |
| Sources  | Product Book Doc 11 §8, §10, Doc 20 "Evidence" (witness information); T-92, T-93; O-162, O-172, O-176 |

## Business Goal

Witness accounts are part of the evidence: who saw what, recorded close to the event, kept unchanged after closure (Doc 11 §10 "Witness records should become read-only after closure").

## User Story

As an **investigator**, I want to record the witnesses of an event and their statements, so that the investigation rests on first-hand accounts.

## Description

A **Witnesses** panel on the event page lists up to **20** witnesses. A witness has:

| Field            | Rule (O-172)                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Person           | a workforce member or user of the company (fills name and company), or a typed name 2–120 |
| Company          | text ≤ 120 (employer, contractor)                                                         |
| Contact          | phone or email, optional, ≤ 120                                                           |
| Statement        | ≤ 4,000 characters, optional until the investigation completes                            |
| Statement date   | date, not in the future, not before the event                                             |
| Taken by         | the user who recorded the statement (automatic)                                           |
| Signed statement | optional file (PDF, JPEG, PNG ≤ 10 MB; category `safety_event_sensitive`)                 |

**When reporting** (US-040–042) the reporter may name witnesses (person, company, contact), also offline. **During the investigation** the team and `.manage` holders add witnesses, record statements and attach signed copies (online). A statement once saved can be **edited by its author** until the investigation completes (old text kept in history); after that it is read-only, and the whole panel is read-only once the event is **Closed** or **Voided**.

Visibility (T-93): **names and companies** for every viewer; **contact, statement and the signed copy** for the Team, `.manage`, `.close` and Sensitive audiences. A witness who is a project user is not given access to the event by being a witness.

A witness can be **removed** (wrong person) before closure with a reason; the row is kept, hidden, and shown in history.

## Actors

Reporter (names at report time); lead investigator and team; `.manage` holders; readers.

## Preconditions

- Event not Closed or Voided; caller on the team or `.manage` (adding during review or investigation), or the reporter before review starts.

## User Flow

1. Event page → Witnesses → **Add witness** → picks "Khalid (Workforce · Al-Bina Contracting)".
2. **Record statement** → types the statement, date today → **Save**. Optionally attaches a scan of the signed statement.
3. Witness card: "Khalid · Al-Bina Contracting · Statement 26 Nov, taken by Omar".

## Functional Requirements

The system shall:

1. Store witnesses in `safety_event_witness` (`event_id`, `workforce_member_id` / `user_id` / `name`, `company`, `contact`, `statement`, `statement_on`, `taken_by`, `removed_at/by/reason`, `version`, audit columns).
2. Accept reporter witnesses on the report (offline too) and team / manager witnesses online; enforce 20 per event (removed ones not counted).
3. Let only the statement's author edit it, until the investigation completes; keep every previous text in the activity history (Team and Sensitive audiences).
4. Strip contact, statement and signed copy from responses for other audiences.
5. Lock all witness writes when the event is Closed or Voided (`409 SAFETY_EVENT_LOCKED`).

## Validation Rules

As the table; a linked person must belong to the company; the same linked person only once per event; removal reason 5–500.

## Permission Rules

As the Description; the reporter only at report time and until review starts.

## Database Impact

`safety_event_witness` as FR-1; `safety_event_file.witness_id` (nullable) for signed copies.

## API Requirements

- `GET /api/v1/projects/{projectId}/safety-events/{id}/witnesses`.
- `POST …/witnesses` `{ workforceMemberId? | userId? | name, company?, contact? }`.
- `PATCH …/witnesses/{witnessId}` `{ baseVersion, company?, contact?, statement?, statementOn? }`.
- `POST …/witnesses/{witnessId}/remove` `{ reason }`.
- `POST …/safety-events/{id}/files` `{ category: sensitive, witnessId }`.

## UI Requirements

- Witness cards with a lock icon on statement and contact for audiences who can't see them ("Statement recorded").
- Statement editor full-screen on phone, character count.

## Error Handling

| Case                                               | Response                         |
| -------------------------------------------------- | -------------------------------- |
| More than 20 witnesses                             | `422 SAFETY_EVENT_WITNESS_LIMIT` |
| Same person twice                                  | `422 VALIDATION_FAILED`          |
| Statement edited by someone else                   | `403 FORBIDDEN`                  |
| Event Closed or Voided; statement after completion | `409 SAFETY_EVENT_LOCKED`        |

## Notifications

None.

## Audit Requirements

`safety_event.witness_changed` (added, statement recorded, statement edited, removed; never the statement text in the summary).

## Acceptance Criteria

- A Client sees the witness names but not their contact or statement; the lead investigator sees both.
- A statement edited before completion keeps the previous text in history; after completion it can't be edited.
- After closure, adding a witness is refused.

## Test Scenarios

- **Positive:** reporter witnesses offline; team witnesses with statements and signed copies; removal; visibility per audience.
- **Negative:** limit; duplicate person; non-author edit; writes after completion and after closure; viewer requesting the signed copy.

## Future Improvements

Statement templates and questions; digital witness signatures (Q-24); interviews recorded as audio (Q-32).
