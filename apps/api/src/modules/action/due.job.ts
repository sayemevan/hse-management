import {
  actionReference,
  addIsoDays,
  daysBetween,
  type NotificationParams,
  zonedIsoDate,
} from '@hse/shared';

import type { Statement } from '../../database/unit-of-work';
import type { JobContext, JobResult, ScheduledJob } from '../../platform/jobs';
import { NotificationService } from '../../platform/notification';
import { ReminderService } from '../../platform/reminders';
import { CompanyRepository } from '../company';
import { PermissionResolver, ProjectAudience } from '../identity';
import { ProjectDirectory } from '../project';
import { ActionRepository } from './action.repository';
import type { ActionRow } from './action.schema';

/** A missed run still sends the first-overdue notice within this many days (FR-11). */
const LATE_DAYS = 2;
const PAGE = 500;

/**
 * PLT-23 § Reminder job (T-64). Daily, in each company's time zone: "due tomorrow" and "first
 * day overdue" once per action and due date; one digest per owner per day while they have
 * actions due today or overdue (Critical overdue ones are in it every day until resolved); and
 * "owner has no access" once per action and owner.
 */
export const actionDueJob: ScheduledJob = {
  name: 'actions.due',
  async run({ db, env, logger, clock }: JobContext): Promise<JobResult> {
    const now = clock();
    const repo = new ActionRepository(db);
    const reminders = new ReminderService(db, env.JOBS, logger, clock);
    const notifications = new NotificationService(db, clock);
    const resolver = new PermissionResolver(db, clock);
    const audience = new ProjectAudience(db, clock);
    const result: JobResult = { processed: 0, changed: 0, failed: 0 };

    // Company "today" is within a day of UTC; read a day ahead and filter per company.
    const due = await repo.activeDueUntil(addIsoDays(zonedIsoDate(now, 'UTC'), 2));
    const owned: ActionRow[] = [];
    for (let after: string | null = null; ; ) {
      const page = await repo.ownedNotFinished(after, PAGE);
      owned.push(...page);
      if (page.length < PAGE) break;
      after = page.at(-1)?.id ?? null;
    }
    const companyIds = [...new Set([...due, ...owned].map((row) => row.companyId))];
    const companies = await new CompanyRepository(db).findManyByIds(companyIds);

    const canView = async (userId: string, companyId: string, projectId: string) =>
      (await resolver.projectPermissions(userId, companyId, projectId)).has('projects.view');

    for (const company of companies) {
      try {
        const today = zonedIsoDate(now, company.timeZone);
        const rows = due.filter((row) => row.companyId === company.id);
        const projects = await new ProjectDirectory(db).getMany(company.id, [
          ...new Set([...rows, ...owned.filter((r) => r.companyId === company.id)].map((r) => r.projectId)),
        ]);
        const paramsOf = (row: ActionRow): NotificationParams => {
          const code = projects.get(row.projectId)?.code ?? '';
          return {
            projectCode: code,
            actionReference: actionReference(code, row.number),
            actionTitle: row.title.slice(0, 80),
            priority: row.priority,
            dueOn: row.dueOn,
          };
        };
        const notice = async (
          key: string,
          type: 'action.due_tomorrow' | 'action.overdue',
          row: ActionRow,
          recipients: string[],
          extra: NotificationParams = {},
        ) => {
          const allowed: string[] = [];
          for (const userId of new Set(recipients)) {
            if (await canView(userId, company.id, row.projectId)) allowed.push(userId);
          }
          if (allowed.length === 0) return;
          const outcome = await reminders.sendOnce({
            key,
            companyId: company.id,
            template: type,
            emails: [],
            statements: notifications.entries({
              type,
              companyId: company.id,
              projectId: row.projectId,
              entityType: 'action',
              entityId: row.id,
              actorUserId: null,
              params: { ...paramsOf(row), ...extra },
              recipients: allowed,
            }),
          });
          if (outcome === 'sent') result.changed += 1;
        };

        const digest = new Map<string, { overdue: number; dueToday: number; critical: number }>();
        for (const row of rows) {
          const left = daysBetween(today, row.dueOn);
          if (left > 1) continue;
          result.processed += 1;
          if (left === 1) {
            await notice(`action:${row.id}:due:${row.dueOn}:-1`, 'action.due_tomorrow', row, [
              row.ownerId,
            ]);
            continue;
          }
          const entry = digest.get(row.ownerId) ?? { overdue: 0, dueToday: 0, critical: 0 };
          if (left === 0) entry.dueToday += 1;
          else {
            entry.overdue += 1;
            if (row.priority === 'critical') entry.critical += 1;
            if (-left <= LATE_DAYS + 1) {
              const urgent = row.priority === 'high' || row.priority === 'critical';
              await notice(
                `action:${row.id}:overdue:${row.dueOn}`,
                'action.overdue',
                row,
                urgent ? [row.ownerId, row.createdBy] : [row.ownerId],
                { daysOverdue: -left },
              );
            }
          }
          digest.set(row.ownerId, entry);
        }

        for (const [ownerId, entry] of digest) {
          const outcome = await reminders.sendOnce({
            key: `action-digest:${ownerId}:${today}`,
            companyId: company.id,
            template: 'action.due_digest',
            emails: [],
            statements: notifications.entries({
              type: 'action.due_digest',
              companyId: company.id,
              entityType: 'actions',
              entityId: ownerId,
              actorUserId: null,
              params: {
                count: entry.overdue + entry.dueToday,
                overdue: entry.overdue,
                dueToday: entry.dueToday,
                critical: entry.critical,
              },
              recipients: [ownerId],
            }),
          });
          if (outcome === 'sent') result.changed += 1;
        }

        // O-101: owners who can no longer view the project.
        for (const row of owned.filter((r) => r.companyId === company.id)) {
          if (await canView(row.ownerId, company.id, row.projectId)) continue;
          result.processed += 1;
          const managers = await audience.projectPermissionHolders(
            company.id,
            row.projectId,
            'projects.actions.manage',
            resolver,
          );
          const statements: Statement[] = notifications.entries({
            type: 'action.owner_lost_access',
            companyId: company.id,
            projectId: row.projectId,
            entityType: 'action',
            entityId: row.id,
            actorUserId: null,
            params: paramsOf(row),
            recipients: managers,
          });
          const outcome = await reminders.sendOnce({
            key: `action:${row.id}:owner-lost:${row.ownerId}`,
            companyId: company.id,
            template: 'action.owner_lost_access',
            emails: [],
            statements,
          });
          if (outcome === 'sent') result.changed += 1;
        }
      } catch (error) {
        result.failed += 1;
        logger.error('action reminders failed', { error, companyId: company.id });
      }
    }
    return result;
  },
};
