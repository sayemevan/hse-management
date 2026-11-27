import { daysBetween, SAFETY_EVENT_LIMITS, zonedIsoDate } from "@hse/shared";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";

import type { JobContext, JobResult, ScheduledJob } from "../../platform/jobs";
import { NotificationService } from "../../platform/notification";
import { ReminderService } from "../../platform/reminders";
import { CompanyRepository } from "../company";
import { PermissionResolver } from "../identity";
import { ProjectDirectory } from "../project";
import { SafetyEventContext } from "./safety-event-context";
import {
  safetyEvent,
  safetyEventInvestigation,
  safetyEventType,
} from "./safety-event.schema";
import { SafetyEventService } from "./safety-event.service";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A missed run still sends the first-overdue notice within this many days (as actions). */
const LATE_DAYS = 2;

/**
 * PLT-33 § Daily job (O-182). `safety_event.investigation_overdue` once per event and due date
 * (lead and reviewer), and one `safety_event.review_waiting` digest per manager per day while
 * reported events wait unopened for more than a day.
 */
export const safetyEventDueJob: ScheduledJob = {
  name: "safety_events.due",
  async run({ db, env, logger, clock }: JobContext): Promise<JobResult> {
    const now = clock();
    const result: JobResult = { processed: 0, changed: 0, failed: 0 };
    const reminders = new ReminderService(db, env.JOBS, logger, clock);
    const notifications = new NotificationService(db, clock);
    const resolver = new PermissionResolver(db, clock);
    const ctx = new SafetyEventContext({
      db,
      meta: { requestId: "safety-event-job", ipAddress: null, userAgent: null },
      clock,
      resolver,
    });
    const service = new SafetyEventService(ctx);

    const tomorrowUtc = zonedIsoDate(now + DAY_MS, "UTC");
    const overdue = await db
      .select({ event: safetyEvent, investigation: safetyEventInvestigation })
      .from(safetyEvent)
      .innerJoin(
        safetyEventInvestigation,
        eq(safetyEventInvestigation.eventId, safetyEvent.id),
      )
      .where(
        and(
          eq(safetyEvent.status, "under_investigation"),
          isNull(safetyEvent.voidedAt),
          lt(safetyEventInvestigation.dueOn, tomorrowUtc),
        ),
      )
      .all();
    const waiting = await db
      .select()
      .from(safetyEvent)
      .where(
        and(
          eq(safetyEvent.status, "reported"),
          isNull(safetyEvent.voidedAt),
          isNull(safetyEvent.reviewStartedAt),
          lt(
            safetyEvent.receivedAt,
            new Date(now - SAFETY_EVENT_LIMITS.reviewWaitingDays * DAY_MS),
          ),
        ),
      )
      .all();
    const companyIds = [
      ...new Set([
        ...overdue.map((r) => r.event.companyId),
        ...waiting.map((r) => r.companyId),
      ]),
    ];
    const companies = await new CompanyRepository(db).findManyByIds(companyIds);

    for (const company of companies) {
      try {
        const today = zonedIsoDate(now, company.timeZone);
        const rows = overdue.filter((r) => r.event.companyId === company.id);
        const waits = waiting.filter((r) => r.companyId === company.id);
        const projects = await new ProjectDirectory(db).getMany(company.id, [
          ...new Set([
            ...rows.map((r) => r.event.projectId),
            ...waits.map((r) => r.projectId),
          ]),
        ]);
        const typeIds = [...new Set(rows.map((r) => r.event.typeId))];
        const types = new Map(
          (typeIds.length > 0
            ? await db
                .select()
                .from(safetyEventType)
                .where(inArray(safetyEventType.id, typeIds))
                .all()
            : []
          ).map((t) => [t.id, t]),
        );

        for (const { event, investigation } of rows) {
          if (investigation.dueOn >= today) continue;
          const late = daysBetween(investigation.dueOn, today);
          if (late > LATE_DAYS + 1) continue;
          const project = projects.get(event.projectId);
          if (!project || project.status === "archived") continue;
          result.processed += 1;
          const { members } = await service.investigationOf(event.id);
          const statements = await ctx.notify(
            "safety_event.investigation_overdue",
            event,
            { id: project.id, code: project.code, status: project.status },
            types.get(event.typeId) ?? null,
            null,
            [
              investigation.leadId,
              ...(event.reviewedBy ? [event.reviewedBy] : []),
            ],
            service.canSee({ row: event, investigation, members }),
            { dueOn: investigation.dueOn, daysOverdue: late },
          );
          if (statements.length === 0) continue;
          const outcome = await reminders.sendOnce({
            key: `safety-event:${event.id}:investigation-overdue:${investigation.dueOn}`,
            companyId: company.id,
            template: "safety_event.investigation_overdue",
            emails: [],
            statements,
          });
          if (outcome === "sent") result.changed += 1;
        }

        const perManager = new Map<string, number>();
        for (const row of waits) {
          const project = projects.get(row.projectId);
          if (!project || project.status === "archived") continue;
          result.processed += 1;
          for (const userId of await service.reviewers(
            company.id,
            project.id,
            null,
          )) {
            perManager.set(userId, (perManager.get(userId) ?? 0) + 1);
          }
        }
        for (const [userId, count] of perManager) {
          const outcome = await reminders.sendOnce({
            key: `safety-event-review:${userId}:${today}`,
            companyId: company.id,
            template: "safety_event.review_waiting",
            emails: [],
            statements: notifications.entries({
              type: "safety_event.review_waiting",
              companyId: company.id,
              entityType: "safety_events",
              entityId: userId,
              actorUserId: null,
              params: { count },
              recipients: [userId],
            }),
          });
          if (outcome === "sent") result.changed += 1;
        }
      } catch (error) {
        result.failed += 1;
        logger.error("safety event reminders failed", {
          error,
          companyId: company.id,
        });
      }
    }
    return result;
  },
};
