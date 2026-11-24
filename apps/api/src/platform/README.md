# Platform services

Shared services used by every module (Master Rules §5–9, Product Book Doc 01 §6, Doc 32):
audit log, file storage (R2), notification, comments, activity timeline, search, report export, workflow.

Empty in Sprint 0; built just before the first module that needs each one (see `docs/05_SPRINT_PLAN.md`).

| Service                   | Since    | Use                                                                                                                                                                        |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit-log`               | Sprint 1 | `AuditLogService.entry()` in the change's `UnitOfWork`.                                                                                                                    |
| `email`, `one-time-token` | Sprint 2 | Outbox emails and single-use links.                                                                                                                                        |
| `file-storage`            | Sprint 3 | R2 files with categories.                                                                                                                                                  |
| `jobs`, `reminders`       | Sprint 4 | Daily jobs; `ReminderService.sendOnce()` (emails and other statements, once per key).                                                                                      |
| `notification`            | Sprint 6 | `NotificationService.entries(event)` in the change's `UnitOfWork`; add new types to `NOTIFICATION_TYPES` in the shared package and their sentence to the web translations. |
| `activity`                | Sprint 6 | `ActivityService.entry(event)` in the change's `UnitOfWork`; add new actions to `ACTIVITY_ACTIONS`. Append-only.                                                           |

Sprint 7: `activity` also serves one record's history (`listForEntity`, the workforce profile History tab); `file-storage` has three workforce categories that only the workforce routes serve (`MODULE_SERVED_CATEGORIES`, T-49).

Comments are planned for Sprint 8 (O-57).
One implementation per concern: modules must never build their own.
