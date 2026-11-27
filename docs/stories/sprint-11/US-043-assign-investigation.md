# US-043 — Review Event and Assign Investigation

| Field    | Value                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 06 — Safety Event Engine (Doc 14; Doc 20 "Epic 05", O-156)                                                                                                |
| Priority | Must                                                                                                                                                           |
| Status   | Approved                                                                                                                                                       |
| Sources  | Product Book Doc 11 §2, §6, §7, §9, §12, §14, Doc 20 "Investigation", business rules; T-86, T-87, T-89; O-157, O-159, O-160, O-166, O-169, O-170, O-175, O-179 |

## Business Goal

Every report is looked at by the safety team, classified on the company's scale and sent down the right path — investigated when serious, acted on when not — so nothing waits unread and every high-severity event is investigated (Doc 20 "High severity events should require investigation").

## User Story

As a **Safety Officer**, I want to review a new report, confirm its type, severity and risk, and assign an investigation or raise actions, so that each event gets the response it needs.

## Description

**Review.** Opening a Reported event as a `.manage` holder shows **Start review**; it sets "Under review" (`review_started_at`, the reporter can no longer edit, PLT-33). The **Review** sheet:

| Part        | Rule                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type        | any active type; a family change shows the new sections (e.g. near miss → incident adds People) and their required fields must then be filled                  |
| Categories  | 1–3, required                                                                                                                                                  |
| Severity    | confirmed severity, required, ≥ type minimum; the reporter's proposal shown beside it                                                                          |
| Risk rating | likelihood × consequence on the **matrix grid** (PLT-34); required when the type says so (hazard and near-miss families by default); score and band shown live |
| Place       | can be corrected                                                                                                                                               |
| Review note | optional, ≤ 2,000                                                                                                                                              |

The sheet then shows "Investigation required" (with the reason: type rule or severity, O-159) or "Investigation optional", and the decisions available:

1. **Assign investigation** → lead investigator (people with `projects.safety_events.investigate` on the project, the reporter excluded for a required investigation), up to 5 team members, due date proposed by severity (Critical 7 days, High 14, Medium 21, Low 30), instructions (≤ 1,000). → **Under Investigation**.
2. **Raise actions without investigation** (only if not required) → one or more **immediate actions** (title, owner, due date, priority = severity by default); each creates a recommendation of kind `immediate` and its action through `ActionEngine` in the batch (T-89). → **Corrective Action**.
3. **Close — no further action** (only if not required, needs `.close`) → US-046.
4. **Void** → reason kind and text (O-179).

Saving the classification without a decision is allowed (**Save**); the event stays Reported and "Under review". A raised severity re-runs the rule and the notifications (`.high_reported` / `.critical_reported` when it crosses).

**Reassign** (Under Investigation, `.manage`): change the lead (reason 5–500) or the team; the old lead and removed members lose team access at once (T-93) and are notified.

**Self-review:** if the reporter is the only `.manage` holder on the project (company-wide roles excluded), they may review their own report; the event records "Self-reviewed".

## Actors

`.manage` holders (Safety Officer, HSE Manager, Project Manager …); the lead investigator and team; the reporter (told of changes through My reports).

## Preconditions

- Event Reported (review, decisions) or Under Investigation (reassign); caller holds `.manage` on the project.

## User Flow

1. My reports → **To review** → RMX-02-EVT-0014 → **Start review**.
2. Confirms Unsafe Condition, categories Working at Height, severity **High**, risk Likely × Major = 16 → **High**.
3. "Investigation required — severity High." → **Assign investigation** → lead "Omar (Site Engineer)", team "Lina (Supervisor)", due in 14 days → **Assign**.
4. The event shows **Under Investigation · Due 11 Dec**; Omar and Lina are notified.

## Functional Requirements

The system shall:

1. Record review start once (`POST …/review-start`, idempotent for the same reviewer; a blocked write for read-only companies, as inspections).
2. Validate classification (categories, severity, risk rating rule, place) and store the risk snapshot with `rateRisk` on the server (T-87).
3. Evaluate `investigationRequired` and refuse `act` and `close` when it is true (`409 SAFETY_EVENT_INVESTIGATION_REQUIRED`).
4. On `assign`: create `safety_event_investigation` (lead, due date, instructions) and members; status Under Investigation; notifications; audit; activity — one batch.
5. On `act`: create the recommendations and their actions with `ActionEngine.prepare` and one `peekNumber()` (consecutive numbers); status Corrective Action — one batch; any failure leaves no action and no number used.
6. On `reassign`: replace lead or members, notify both sides; refuse a lead without `.investigate` (`422 SAFETY_EVENT_INVESTIGATOR_NOT_ELIGIBLE`).
7. Refuse self-review except in the case above; refuse the reporter as lead of a required investigation.

## Validation Rules

Categories 1–3 active; severity ≥ minimum; risk levels within the matrix size; due date today or later; lead and members hold `.investigate` on the project and are active users; up to 5 members, no duplicates, lead not a member; instructions ≤ 1,000; reassign reason 5–500; immediate actions: title 5–200, owner can view the project, due date not past, priority from the four.

## Permission Rules

`.manage` for review, classification, assign, act, reassign, void; `.close` for close; `projects.actions.create` is **not** needed in addition (raising an action from the review is part of `.manage`).

## Database Impact

`safety_event` review columns (PLT-33); `safety_event_investigation`: `id`, `company_id`, `event_id` (unique), `lead_id`, `due_on`, `instructions`, `assigned_at/by`, `started_at`, `completed_at/by`, `sequence_of_events`, `lessons_learned`, `version`; `safety_event_investigation_member`: `investigation_id`, `user_id`, `added_at/by`, `removed_at/by`; `safety_event_recommendation` (US-044).

## API Requirements

- `POST /api/v1/projects/{projectId}/safety-events/{id}/review-start`.
- `PATCH …/safety-events/{id}` `{ baseVersion, typeId?, categoryIds?, severity?, risk?: { likelihood, consequence }, placeId?, reviewNote? }` (classification, `.manage`).
- `POST …/transitions` `{ to: 'assign', leadId, memberIds, dueOn, instructions? }` · `{ to: 'act', actions: [{ title, description?, ownerId, dueOn, priority }] }` · `{ to: 'reassign', leadId?, memberIds?, reason? }` · `{ to: 'void', kind, reason, duplicateOf? }`.

## UI Requirements

- The matrix grid is tappable cells with score and band word; the chosen cell is outlined and announced.
- "Investigation required" as an icon and sentence with the reason; disabled decisions say why.
- Investigator picker shows role and project; the reporter is marked "Reporter".

## Error Handling

| Case                               | Response                                     |
| ---------------------------------- | -------------------------------------------- |
| Risk rating missing where required | `422 RISK_RATING_REQUIRED`                   |
| Severity below minimum             | `422 SAFETY_EVENT_SEVERITY_BELOW_MINIMUM`    |
| Skip a required investigation      | `409 SAFETY_EVENT_INVESTIGATION_REQUIRED`    |
| Lead not eligible                  | `422 SAFETY_EVENT_INVESTIGATOR_NOT_ELIGIBLE` |
| Event moved on meanwhile           | `409 SAFETY_EVENT_TRANSITION_NOT_ALLOWED`    |
| Actions on an On Hold project      | `409 PROJECT_NOT_ACCEPTING_RECORDS`          |
| Void with open actions             | `409 SAFETY_EVENT_OPEN_ACTIONS`              |

## Notifications

`safety_event.investigation_assigned`, `.investigation_unassigned`, `.high_reported` / `.critical_reported` on a raised severity, `.voided`; actions notify through the action engine (`action.assigned`).

## Audit Requirements

`safety_event.review_started`, `safety_event.classified` (old and new, risk snapshot), `safety_event.investigation_assigned`, `safety_event.investigation_reassigned`, `safety_event.team_changed`, `safety_event.action_raised` (action numbers), `safety_event.voided`.

## Acceptance Criteria

- A Lost Time Injury (type rule `required`) can only be assigned for investigation: "Raise actions" and "Close" are refused.
- A Hazard confirmed High (`by_severity`) can only be assigned for investigation; confirmed Medium it can go to actions or be closed.
- An Unsafe Condition confirmed Medium can go straight to Corrective Action with two immediate actions numbered consecutively.
- Raising a reviewed event from Medium to Critical alerts the Company Administrators.
- A removed team member can no longer open the event's people section.

## Test Scenarios

- **Positive:** review and save; each decision; reassign lead and team; self-review when alone; family change near miss → incident.
- **Negative:** each validation rule; non-manager; two reviewers deciding at once; required investigation skipped (type rule and severity rule); reporter as lead of a required investigation; void with open actions.

## Future Improvements

Review service-level targets per severity (e.g. Critical reviewed within 2 hours) with escalation; investigation teams including external people.
