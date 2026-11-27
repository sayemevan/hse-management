import { OFFLINE_LIMITS } from '@hse/shared';

import type { JobContext, JobResult, ScheduledJob } from '../../platform/jobs';
import { NotificationService } from '../../platform/notification';
import { ReminderService } from '../../platform/reminders';
import { IdempotencyService, SyncConflictService } from '../../platform/sync';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sprint 9 daily job: removes idempotency keys older than 30 days (O-124) and reminds each user
 * once about a conflict still open after 2 days (O-131).
 */
export const syncMaintenanceJob: ScheduledJob = {
  name: 'sync.maintenance',
  async run({ db, env, logger, clock, runId }: JobContext): Promise<JobResult> {
    const result: JobResult = { processed: 0, changed: 0, failed: 0 };
    const purged = await new IdempotencyService(db, clock).purgeExpired();
    result.processed += purged;
    result.changed += purged;

    const reminders = new ReminderService(db, env.JOBS, logger, clock);
    const notifications = new NotificationService(db, clock);
    const conflicts = new SyncConflictService(
      db,
      { requestId: runId, ipAddress: null, userAgent: null },
      clock,
    );
    const due = await conflicts.openBefore(clock() - OFFLINE_LIMITS.conflictReminderDays * DAY_MS);
    for (const row of due) {
      result.processed += 1;
      try {
        const outcome = await reminders.sendOnce({
          key: `sync.conflict:${row.id}:reminder`,
          companyId: row.companyId,
          template: 'sync.conflict',
          emails: [],
          statements: notifications.entries({
            type: 'sync.conflict',
            companyId: row.companyId,
            projectId: row.projectId,
            entityType: 'sync_conflict',
            entityId: row.id,
            actorUserId: null,
            params: {
              recordLabel: row.label.slice(0, 80),
              conflictId: row.id,
              again: true,
              ...(row.projectCode ? { projectCode: row.projectCode } : {}),
            },
            recipients: [row.userId],
          }),
        });
        if (outcome === 'sent') result.changed += 1;
      } catch (error) {
        result.failed += 1;
        logger.error('sync conflict reminder failed', { conflictId: row.id, error });
      }
    }
    return result;
  },
};
