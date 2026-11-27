# Safety event module (Sprint 11: PLT-33, US-040 – US-046)

The one safety event engine (Doc 11, D-62, D-63): hazards, unsafe acts and conditions, near
misses and incidents in one model. The type's family decides the form; its rules decide the
workflow (mandatory investigation, minimum severity, risk rating).

| File                        | What it does                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `safety-event.schema.ts`    | Tables: types, lists, events, category links, people, witnesses, investigation, members, causes, recommendations, files.         |
| `settings.service.ts`       | Types and the three company lists (categories, immediate and root causes), seeded on first use; the device pack.                 |
| `safety-event-context.ts`   | Shared services of one request; `record` keeps sensitive entries off the project timeline; `notify` checks who may still see it. |
| `safety-event.service.ts`   | Access (`safetyEventAccess`, T-93), DTOs per audience, lists, My reports, reports online and offline, files, people, witnesses.  |
| `safety-event-workflow.ts`  | Review and classification, `SAFETY_EVENT_WORKFLOW` moves, investigation content, recommendations and actions, the action hook.   |
| `safety-event-sync.ts`      | Sync entity `safety_event` (the reporter's fields) for conflict review.                                                          |
| `safety-event-directory.ts` | What other modules may know (counts, notification links).                                                                        |
| `due.job.ts`                | Daily `safety_events.due`: overdue investigations and the review-waiting digest (O-182).                                         |

## Rules worth knowing

- **One access rule** (`safetyEventAccess`): reporter, viewer, team (lead and members), manager,
  closer, sensitive reader. People, sensitive files and their history are returned only to the
  team and `projects.safety_events.sensitive.view`; witness contacts and statements only to the
  team, managers and closers. A reporter without view access sees their report, its status and
  the closure summary.
- **Investigation required** comes from one shared function (`investigationRequired`): the type
  says `required`, or the confirmed severity is High or Critical for `by_severity` types.
- Every status change goes through `SAFETY_EVENT_WORKFLOW` with a guard on version **and** the
  writer's own time and user (two writers that read the same version can't both win).
- Starting a review does not bump the version (the reviewer's page holds it); reporter edits are
  refused once `review_started_at` is set. A photo captured before that time is still accepted.
- Every action belongs to a **recommendation** (source `safety_event`, record = recommendation).
  Closing the last one moves the event to Verification inside the action engine's batch;
  voiding one re-opens its recommendation.
- Risk ratings are snapshots (matrix version, levels, score, band and label) from the `risk`
  module; editing the matrix never changes them.
- Events and their child rows are never deleted (database triggers).
