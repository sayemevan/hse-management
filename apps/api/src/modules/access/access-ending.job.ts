import { nextIsoDate, zonedIsoDate } from '@hse/shared';

import { ActivityService } from '../../platform/activity';
import type { JobContext, JobResult, ScheduledJob } from '../../platform/jobs';
import { NotificationService } from '../../platform/notification';
import { ReminderService } from '../../platform/reminders';
import { ProjectAudience } from '../identity';
import { ProjectDirectory } from '../project';

const DAY_MS = 24 * 60 * 60 * 1000;
/** PLT-17 `project.member.access_ending`: three days before the last day. */
const NOTICE_DAYS = 3;

function addDays(isoDate: string, days: number): string {
  let result = isoDate;
  for (let index = 0; index < days; index += 1) result = nextIsoDate(result);
  return result;
}

/**
 * US-022 FR-10. Daily: tells members (and whoever gave the role) three days before a dated
 * project role ends, and writes "access ended" on the project timeline after it ended. Each
 * is sent once, through reminder keys (PLT-09).
 */
export const accessEndingJob: ScheduledJob = {
  name: 'projects.access_ending',
  async run({ db, env, logger, clock }: JobContext): Promise<JobResult> {
    const now = clock();
    const audience = new ProjectAudience(db, clock);
    const reminders = new ReminderService(db, env.JOBS, logger, clock);
    const notifications = new NotificationService(db, clock);
    const activity = new ActivityService(db, clock);
    const projects = new ProjectDirectory(db);
    const result: JobResult = { processed: 0, changed: 0, failed: 0 };

    // Ending soon: last day within the next three days (a missed run still sends it once).
    for (const row of await audience.projectRolesEndingBetween(
      now,
      now + (NOTICE_DAYS + 1) * DAY_MS,
    )) {
      const lastDay = zonedIsoDate(row.validUntil.getTime() - 1, row.timeZone);
      const today = zonedIsoDate(now, row.timeZone);
      if (lastDay < today || lastDay > addDays(today, NOTICE_DAYS)) continue;
      result.processed += 1;
      try {
        const project = await projects.get(row.companyId, row.projectId);
        if (!project || project.status === 'archived') continue;
        const [member, assigner] = await Promise.all([
          audience.activeOnly([row.userId]),
          audience.activeOnly(row.createdBy && row.createdBy !== row.userId ? [row.createdBy] : []),
        ]);
        const base = {
          type: 'project.member.access_ending' as const,
          companyId: row.companyId,
          projectId: row.projectId,
          entityType: 'project',
          entityId: row.projectId,
          actorUserId: null,
        };
        const params = {
          projectCode: project.code,
          projectName: project.name,
          roleCode: row.roleCode,
          validUntil: lastDay,
          memberName: row.fullName,
        };
        const outcome = await reminders.sendOnce({
          key: `role:${row.id}:ending:${lastDay}`,
          companyId: row.companyId,
          template: 'project.member.access_ending',
          emails: [],
          statements: [
            ...notifications.entries({
              ...base,
              params: { ...params, self: true },
              recipients: member,
            }),
            ...notifications.entries({
              ...base,
              params: { ...params, self: false },
              recipients: assigner,
            }),
          ],
        });
        if (outcome === 'sent') result.changed += 1;
      } catch (error) {
        result.failed += 1;
        logger.error('access ending notice failed', { error, assignmentId: row.id });
      }
    }

    // Ended: the timeline entry, written once after the last day.
    for (const row of await audience.projectRolesEndingBetween(now - NOTICE_DAYS * DAY_MS, now)) {
      result.processed += 1;
      try {
        const project = await projects.get(row.companyId, row.projectId);
        if (!project) continue;
        const outcome = await reminders.sendOnce({
          key: `role:${row.id}:ended`,
          companyId: row.companyId,
          template: 'member.access_ended',
          emails: [],
          statements: [
            activity.entry({
              action: 'member.access_ended',
              companyId: row.companyId,
              projectId: row.projectId,
              entityType: 'user',
              entityId: row.userId,
              actorUserId: null,
              snapshot: {
                projectCode: project.code,
                projectName: project.name,
                memberName: row.fullName,
                roleCode: row.roleCode,
              },
            }),
          ],
        });
        if (outcome === 'sent') result.changed += 1;
      } catch (error) {
        result.failed += 1;
        logger.error('access ended entry failed', { error, assignmentId: row.id });
      }
    }
    return result;
  },
};

/** PLT-17 FR-9 (O-63). */
export const notificationPurgeJob: ScheduledJob = {
  name: 'notifications.purge',
  async run({ db, clock }: JobContext): Promise<JobResult> {
    const removed = await new NotificationService(db, clock).purgeExpired();
    return { processed: removed, changed: removed, failed: 0 };
  },
};
