import { daysBetween, INSPECTION_LIMITS, inspectionReference, zonedIsoDate } from '@hse/shared';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';

import type { JobContext, JobResult, ScheduledJob } from '../../platform/jobs';
import { NotificationService } from '../../platform/notification';
import { ReminderService } from '../../platform/reminders';
import { CompanyRepository } from '../company';
import { PermissionResolver } from '../identity';
import { ProjectDirectory } from '../project';
import { InspectionContext } from './inspection-context';
import { inspection, inspectionTemplate } from './inspection.schema';
import { InspectionService } from './inspection.service';
import { InspectionWorkflow } from './inspection-workflow';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A missed run still sends the first-overdue notice within this many days. */
const LATE_DAYS = 2;

/**
 * PLT-32 § Daily job (O-150, O-152). `inspection.overdue` once per inspection and planned date
 * (inspector and planner), and one `inspection.review_waiting` digest per reviewer per day while
 * submitted inspections wait longer than two days.
 */
export const inspectionDueJob: ScheduledJob = {
  name: 'inspections.due',
  async run({ db, env, logger, clock }: JobContext): Promise<JobResult> {
    const now = clock();
    const result: JobResult = { processed: 0, changed: 0, failed: 0 };
    const reminders = new ReminderService(db, env.JOBS, logger, clock);
    const notifications = new NotificationService(db, clock);
    const resolver = new PermissionResolver(db, clock);
    const ctx = new InspectionContext({
      db,
      meta: { requestId: 'inspection-job', ipAddress: null, userAgent: null },
      clock,
      resolver,
    });
    const workflow = new InspectionWorkflow(new InspectionService(ctx));

    const tomorrowUtc = zonedIsoDate(now + DAY_MS, 'UTC');
    const overdue = await db
      .select()
      .from(inspection)
      .where(
        and(
          inArray(inspection.status, ['draft', 'in_progress']),
          isNull(inspection.cancelledAt),
          lt(inspection.plannedOn, tomorrowUtc),
        ),
      )
      .all();
    const waiting = await db
      .select()
      .from(inspection)
      .where(
        and(
          eq(inspection.status, 'submitted'),
          lt(inspection.submittedAt, new Date(now - INSPECTION_LIMITS.reviewWaitingDays * DAY_MS)),
        ),
      )
      .all();
    const companyIds = [...new Set([...overdue, ...waiting].map((row) => row.companyId))];
    const companies = await new CompanyRepository(db).findManyByIds(companyIds);

    for (const company of companies) {
      try {
        const today = zonedIsoDate(now, company.timeZone);
        const rows = overdue.filter((r) => r.companyId === company.id);
        const waits = waiting.filter((r) => r.companyId === company.id);
        const projects = await new ProjectDirectory(db).getMany(company.id, [
          ...new Set([...rows, ...waits].map((r) => r.projectId)),
        ]);
        const templateIds = [...new Set(rows.map((r) => r.templateId))];
        const templates = new Map(
          (templateIds.length > 0
            ? await db.select().from(inspectionTemplate).where(inArray(inspectionTemplate.id, templateIds)).all()
            : []
          ).map((t) => [t.id, t]),
        );

        for (const row of rows) {
          if (!row.plannedOn || row.plannedOn >= today) continue;
          const late = daysBetween(row.plannedOn, today);
          if (late > LATE_DAYS + 1) continue;
          const project = projects.get(row.projectId);
          if (!project || project.status === 'archived') continue;
          result.processed += 1;
          const statements = await ctx.notify(
            'inspection.overdue',
            row,
            { id: project.id, code: project.code, status: project.status },
            templates.get(row.templateId) ?? null,
            null,
            [row.inspectorId, ...(row.plannedBy ? [row.plannedBy] : [])],
          );
          if (statements.length === 0) continue;
          const outcome = await reminders.sendOnce({
            key: `inspection:${row.id}:overdue:${row.plannedOn}`,
            companyId: company.id,
            template: 'inspection.overdue',
            emails: [],
            statements,
          });
          if (outcome === 'sent') result.changed += 1;
        }

        const perReviewer = new Map<string, number>();
        for (const row of waits) {
          const project = projects.get(row.projectId);
          if (!project || project.status === 'archived') continue;
          result.processed += 1;
          const reviewers = await workflow.reviewers(
            { id: company.id },
            { id: project.id, code: project.code, status: project.status },
            row,
          );
          for (const userId of reviewers) perReviewer.set(userId, (perReviewer.get(userId) ?? 0) + 1);
        }
        for (const [userId, count] of perReviewer) {
          const outcome = await reminders.sendOnce({
            key: `inspection-review:${userId}:${today}`,
            companyId: company.id,
            template: 'inspection.review_waiting',
            emails: [],
            statements: notifications.entries({
              type: 'inspection.review_waiting',
              companyId: company.id,
              entityType: 'inspections',
              entityId: userId,
              actorUserId: null,
              params: { count },
              recipients: [userId],
            }),
          });
          if (outcome === 'sent') result.changed += 1;
        }
        void inspectionReference;
      } catch (error) {
        result.failed += 1;
        logger.error('inspection reminders failed', { error, companyId: company.id });
      }
    }
    return result;
  },
};
