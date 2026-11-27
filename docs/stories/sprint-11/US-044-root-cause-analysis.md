# US-044 — Root Cause Analysis

| Field    | Value                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 06 — Safety Event Engine (Doc 14; Doc 20 "Epic 05", O-156)                                                                  |
| Priority | Must                                                                                                                             |
| Status   | Approved                                                                                                                         |
| Sources  | Product Book Doc 11 §9, §11, §19, Doc 20 "Investigation", "Action Management", Doc 13 (actions); T-88, T-89; O-170, O-171, O-176 |

## Business Goal

An investigation finds **why** an event happened, not only what, and turns every recommendation into a tracked action, so the same event doesn't happen again (Doc 11 §9, §11; Doc 20 "Identify root causes", "Track corrective actions").

## User Story

As a **lead investigator**, I want to record the sequence of events, the immediate and root causes, contributing factors, recommendations and lessons learned, and raise corrective actions, so that the event is understood and fixed.

## Description

The event page's **Investigation** tab (Team audience writes; viewers and the reporter's view per T-93) is a workspace saved section by section (online only):

| Section                     | Content (O-171)                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sequence of events          | text ≤ 4,000 ("07:40 rigging started …")                                                                                                                                                                                                                   |
| Immediate causes            | 1–10: category from **Immediate cause categories** (seeded: Unsafe act, Unsafe condition) + description ≤ 1,000                                                                                                                                            |
| Root causes                 | 1–10: category from **Root cause categories** (seeded: People / Competence, Procedures, Equipment / Tools, Work environment, Supervision, Management / Organisation, Design) + description ≤ 1,000 + optional **5 Whys** (up to 5 "Why?" lines ≤ 300 each) |
| Contributing factors        | 0–10 lines ≤ 1,000                                                                                                                                                                                                                                         |
| Recommendations             | 1–20: kind **Corrective**, **Preventive** or **Improvement**, description ≤ 1,000, linked root cause(s) optional; per recommendation **Raise action** (title, owner, due date, priority) or **No action needed** (reason 5–500)                            |
| Lessons learned             | text ≤ 4,000 (shown to the reporter on closure if the closer includes it in the summary)                                                                                                                                                                   |
| People, witnesses, evidence | US-042, US-045; the team can add evidence (100-file limit)                                                                                                                                                                                                 |

**Raise action** works during the investigation (an urgent fix shouldn't wait) and afterwards until closure: it creates the action through `ActionEngine` with source `{ module: 'safety_event', recordId: recommendationId }` (T-89), type = the recommendation kind (Corrective → `corrective`, Preventive → `preventive`, Improvement → `improvement`), priority defaulting to the event's severity. A recommendation's status: **Open**, **Action raised**, **Resolved** (its actions closed), **No action needed**.

**Complete investigation** (lead only) checks: sequence, ≥ 1 immediate cause, ≥ 1 root cause, ≥ 1 recommendation, lessons learned, and every recommendation either has an action or "No action needed". Missing parts are listed (`422 SAFETY_EVENT_INVESTIGATION_INCOMPLETE`). Completing moves the event to **Corrective Action**, or straight to **Verification** if nothing is open. After completion the causes and lessons are read-only; recommendations can still get new actions (and a closer can **return** the investigation, US-046).

The settings screen gains the two cause lists (`safety_events.settings.manage`), managed like the other company lists.

## Actors

Lead investigator (writes, completes); team members (write, can't complete); `.manage` holders (read, raise actions); viewers (read).

## Preconditions

- Event Under Investigation (writes; recommendations' actions also in Corrective Action and Verification); caller on the team.

## User Flow

1. Investigation tab → Sequence of events → **Save**.
2. Immediate cause: Unsafe condition — "No edge protection on the east side". Root cause: Procedures — 5 Whys: "Why was it removed? For a delivery." → "Why not replaced? Nobody was responsible." …
3. Recommendations: Corrective "Reinstall edge protection" → **Raise action** for the Supervisor, due tomorrow, High; Preventive "Add edge-protection check to the daily inspection" → **Raise action** for the HSE Manager.
4. Lessons learned → **Complete investigation** → the event shows **Corrective Action · 2 actions open**.

## Functional Requirements

The system shall:

1. Store the investigation texts on `safety_event_investigation`, causes in `safety_event_cause` (`kind`: `immediate`, `root`, `contributing`; `category_id`; `description`; `whys` JSON; `sort`), recommendations in `safety_event_recommendation` (`kind`, `description`, `root_cause_ids`, `status`, `no_action_reason`, `seq`).
2. Save each section with `baseVersion` on the investigation (`409 SAFETY_EVENT_INVESTIGATION_CHANGED` when two team members save the same section; different sections don't conflict).
3. Set `started_at` on the first save.
4. Raise actions as T-89 in the batch with the recommendation status change; several actions in one save get consecutive numbers.
5. On complete: validate, set `completed_at/by`, status per the workflow, notify — one batch.
6. Resolve recommendations through `onActionChanged` (PLT-33).
7. Show the investigation to viewers read-only; hide it from a reporter without view access (they see "Under investigation").

## Validation Rules

As the table and O-176; categories active (or the one already stored); up to 20 recommendations; action fields as US-043; due dates not past.

## Permission Rules

Team audience writes (T-93); `.manage` raises actions and marks No action needed; only the lead completes. `projects.actions.create` is not required for the team (raising from a recommendation is part of the investigation).

## Database Impact

`safety_event_cause`, `safety_event_recommendation` (both with `company_id`, audit columns, `version`); `safety_cause_category` (company list with `kind`, names en/ar, active, sort).

## API Requirements

- `GET`, `PUT /api/v1/projects/{projectId}/safety-events/{id}/investigation` `{ baseVersion, sequenceOfEvents?, lessonsLearned? }`.
- `PUT …/investigation/causes` `{ baseVersion, kind, items: [...] }` (whole list per kind).
- `POST`, `PATCH …/recommendations…`; `POST …/recommendations/{recId}/actions` `{ title, ownerId, dueOn, priority, description? }`; `POST …/recommendations/{recId}/no-action` `{ reason }`.
- `POST …/transitions` `{ to: 'complete_investigation' }`.
- `GET`, `POST`, `PATCH /api/v1/safety-cause-categories…`.

## UI Requirements

- One card per section with its own **Save** and "Saved · 2 min ago"; incomplete sections marked with an icon and words.
- 5 Whys as a numbered list that grows to 5.
- Recommendations show their action numbers and statuses (from the action engine) with links.

## Error Handling

| Case                               | Response                                           |
| ---------------------------------- | -------------------------------------------------- |
| Not on the team                    | `403 FORBIDDEN`                                    |
| Complete with missing parts        | `422 SAFETY_EVENT_INVESTIGATION_INCOMPLETE` (list) |
| Complete by a team member          | `403 FORBIDDEN`                                    |
| Edit after completion              | `409 SAFETY_EVENT_LOCKED` (causes, lessons)        |
| Recommendation already resolved    | `409 RECOMMENDATION_LOCKED`                        |
| Same section saved by someone else | `409 SAFETY_EVENT_INVESTIGATION_CHANGED`           |

## Notifications

`safety_event.investigation_completed` (reviewer and closers); actions through the action engine.

## Audit Requirements

`safety_event.investigation_updated` (sections changed), `safety_event.action_raised`, `safety_event.recommendation_no_action`, `safety_event.investigation_completed`.

## Acceptance Criteria

- Complete with no root cause is refused and the missing part is named.
- Two actions raised in one save have consecutive numbers and both link to "RMX-02-EVT-0014 · Recommendation n".
- Completing with every recommendation "No action needed" moves the event straight to Verification.
- A viewer sees the causes read-only; the reporter without view access doesn't.

## Test Scenarios

- **Positive:** each section; 5 Whys; raise during and after the investigation; complete to Corrective Action and to Verification; cause list management.
- **Negative:** non-team write; team member completing; incomplete; conflict on the same section; resolved recommendation edited; action on an On Hold project.

## Future Improvements

Configurable investigation templates and methods (fishbone, ICAM, TapRooT) (Doc 11 §9); AI root-cause suggestions (Doc 11 §18); lessons-learned library shared across projects.
