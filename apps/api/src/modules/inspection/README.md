# Inspection module (Sprint 10: PLT-32, US-031 – US-039)

The one inspection engine (Doc 10, D-59, D-60). Templates are company records; inspections are
project records that execute one immutable template version.

| File                      | What it does                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inspection.schema.ts`    | Tables: categories, templates, template versions, inspections, item results, files, findings.                                                                      |
| `inspection-seed.ts`      | The twelve Doc 10 §3 categories and the starter "Daily Site Safety Inspection" (O-141, O-142), seeded on first use.                                                |
| `template.service.ts`     | Categories, templates, drafts, publishing (T-76), retire, duplicate, versions, the device pack.                                                                    |
| `inspection-context.ts`   | Shared services of one request (audit, timeline, notifications, comments, places, numbers, idempotency).                                                           |
| `inspection.service.ts`   | Plan / start (T-82), header and item capture with versions (T-77, T-70), files (T-83), readiness, findings edits, raise action, lists, comments.                   |
| `inspection-workflow.ts`  | The statements of each `INSPECTION_WORKFLOW` move (T-78), findings generation (O-145), approval with actions (O-146), closing (O-138), and the action hook (T-79). |
| `inspection-sync.ts`      | Sync entities `inspection` and `inspection_item` for conflict review (PLT-30).                                                                                     |
| `inspection-directory.ts` | What other modules may know (notification links).                                                                                                                  |
| `due.job.ts`              | Daily `inspections.due`: overdue notices and the review-waiting digest (O-150, O-152).                                                                             |

## Rules worth knowing

- A published version never changes (a database trigger enforces it). Edits go to the one draft.
- Item results are keyed by the item's stable `key`, so results and findings compare across versions.
- Every status change goes through `INSPECTION_WORKFLOW` (shared) with a conditional update on
  `status` and `version`; a lost race answers `INSPECTION_TRANSITION_NOT_ALLOWED`.
- Approval creates its actions with `ActionEngine.prepare(input, number)` in the approval's batch
  (consecutive numbers from one `peekNumber`). The source gives the label itself because its
  findings may be written in the same batch (approve on submit).
- When an action raised from a finding is closed or voided, the action engine calls
  `onFindingActionChanged` inside its batch: the finding resolves (or opens again) and the
  inspection closes once every finding is resolved or needs no action.
- Offline writes: start, header `PATCH`, item `PUT`, files and the `start` / `submit` transitions
  use `idempotent()` and take device ids and `baseVersion`.
