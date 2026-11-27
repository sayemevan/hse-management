# US-046 — Close Event

| Field    | Value                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 06 — Safety Event Engine (Doc 14; Doc 20 "Epic 05", O-156)                                                                    |
| Priority | Must                                                                                                                               |
| Status   | Approved                                                                                                                           |
| Sources  | Product Book Doc 11 §2, §7, §11, §17, Doc 20 "Event Closure", business rules; T-86, T-89; O-158, O-159, O-167, O-174, O-175, O-178 |

## Business Goal

An event is closed only when its findings have been reviewed and every corrective action is done, and once closed its record can no longer change (Doc 20 "Review Findings, Verify Completion, Close Event"; Doc 11 §17 "Closed events become read-only").

## User Story

As an **HSE Manager**, I want to review the investigation and the completed actions and close the event with a summary, so that the record is complete and the reporter learns the outcome.

## Description

**Verification.** When the last open recommendation is resolved (its actions closed — verified through the action engine — or marked No action needed), the event moves to **Verification** automatically (T-89) and `.close` holders are notified. A new action raised meanwhile moves it back to Corrective Action.

**Close** (needs `projects.safety_events.close`). The **Close** sheet shows: the classification and risk, the investigation summary (causes, lessons learned), every recommendation with its actions and their closing notes and evidence links, and the witnesses count. The closer:

- writes the **closure summary** (10–2,000), which the **reporter sees** in My reports (O-167); a "Use lessons learned" button copies them in;
- confirms → **Closed**: the event, investigation, people, witnesses and files become read-only, the comment thread is locked (O-178), `closed_at/by`, `closure_kind = completed`.

The closer of an **investigated** event can't be its lead investigator (`403 SAFETY_EVENT_SELF_CLOSURE`; the company-wide fallback of PLT-33 applies).

**Return investigation** (Verification, investigated events only): the closer sends it back to **Under Investigation** with a reason (5–1,000); the lead is notified; causes and lessons become editable again; existing actions stay.

**Close — no further action** (from Reported, after classification, US-043): only when no investigation is required and nothing is open; reason 10–2,000 becomes the closure summary ("Barrier replaced on the spot by the reporter; checked"), `closure_kind = no_further_action`.

**After closure** (O-158): nothing on the event changes. The page offers **Report a follow-up** (a new event pre-filled with project, place and type, linked both ways) and, for action creators, **Raise a new action** from the closed event (a recommendation of kind `improvement` added as an addendum, recorded in history — the event stays Closed).

## Actors

`.close` holders (HSE Manager, Safety Officer, Project Manager …); the lead investigator (returned to); the reporter (told).

## Preconditions

- Event in Verification (close, return) or Reported with classification complete (no-further-action close); caller holds `.close`.

## User Flow

1. Notification "RMX-02-EVT-0014 is ready to close" → event page → **Close**.
2. Reviews: 2 recommendations, actions RMX-02-ACT-0031 (Closed, verified) and RMX-02-ACT-0032 (Closed, verified).
3. Closure summary: "Edge protection reinstated; daily inspection now checks it; crews briefed." → **Close event**.
4. The reporter sees **Closed** and the summary in My reports.

## Functional Requirements

The system shall:

1. Move Corrective Action → Verification in the action engine's batch when the last recommendation resolves, and back when a recommendation re-opens or a new action is raised (PLT-33).
2. On close: re-check every recommendation is resolved (`409 SAFETY_EVENT_OPEN_ACTIONS` otherwise), the self-closure rule, the closure summary; set status Closed, lock comments, notify — one batch.
3. On no-further-action close: re-check `investigationRequired` is false and nothing is open.
4. On return: status Under Investigation, `completed_at` cleared (kept in history), reason stored, lead notified.
5. Refuse every write to a Closed event and its children (`409 SAFETY_EVENT_LOCKED`), except the follow-up link and the addendum action described above.
6. Show the closure summary (and only that, plus status) to a reporter without view access.

## Validation Rules

Closure summary 10–2,000; return reason 5–1,000; no-further-action reason 10–2,000.

## Permission Rules

`projects.safety_events.close`; not the lead investigator of an investigated event. Addendum action: `projects.actions.create`. Follow-up report: `projects.safety_events.report`.

## Database Impact

`safety_event` closure columns (PLT-33); `safety_event_recommendation.addendum` (boolean) for actions raised after closure.

## API Requirements

- `POST /api/v1/projects/{projectId}/safety-events/{id}/transitions` `{ to: 'close', summary }` · `{ to: 'close', noFurtherAction: true, reason }` · `{ to: 'return', reason }`.
- `POST …/safety-events/{id}/addendum-actions` `{ description, title, ownerId, dueOn, priority }` (Closed only).
- ⚡ `POST /api/v1/projects/{projectId}/safety-events` with `followUpOf`.

## UI Requirements

- The close sheet lists each recommendation with status words and the action numbers in `<bdi dir="ltr">`.
- A closed event shows a banner "Closed on 30 Nov by …" with the summary; edit controls are gone, not disabled.

## Error Handling

| Case                                             | Response                                  |
| ------------------------------------------------ | ----------------------------------------- |
| Something still open                             | `409 SAFETY_EVENT_OPEN_ACTIONS`           |
| Closer is the lead investigator                  | `403 SAFETY_EVENT_SELF_CLOSURE`           |
| Investigation required (no-further-action close) | `409 SAFETY_EVENT_INVESTIGATION_REQUIRED` |
| Not in Verification / moved on                   | `409 SAFETY_EVENT_TRANSITION_NOT_ALLOWED` |
| Write on a closed event                          | `409 SAFETY_EVENT_LOCKED`                 |

## Notifications

`safety_event.verification_ready`, `safety_event.closed` (reporter, lead), `safety_event.returned` (lead).

## Audit Requirements

`safety_event.verification_ready`, `safety_event.closed` (kind, summary length, action numbers), `safety_event.returned`, `safety_event.addendum_action_raised`.

## Acceptance Criteria

- Closing the last verified action moves the event to Verification; the HSE Manager closes it; the reporter (a Worker) sees the summary.
- The lead investigator, holding `.close`, can't close their own investigated event while another closer exists.
- A Medium hazard with no investigation required closes from review with "No further action".
- After closure, editing the description, a witness or a cause is refused; a follow-up report links back.

## Test Scenarios

- **Positive:** close from Verification; no-further-action close; return and re-complete; addendum action after closure; follow-up link both ways.
- **Negative:** open recommendation; self-closure; required investigation; writes after closure; return on a non-investigated event; read-only company.

## Future Improvements

Effectiveness review some weeks after closure; lessons-learned bulletins to all projects; sign-off by the client for selected event types.
