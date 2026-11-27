import type { SafetyEventCountsDto } from "@hse/shared";
import { and, eq, isNull, lt, sql } from "drizzle-orm";

import type { Principal } from "../../core/auth/principal";
import type { Database } from "../../database/client";
import { PermissionResolver } from "../identity";
import { safetyEvent, safetyEventInvestigation } from "./safety-event.schema";

/** What other modules (dashboards later) may know about safety events (PLT-33 FR-7). */
export class SafetyEventDirectory {
  constructor(
    private readonly db: Database,
    private readonly resolver: PermissionResolver = new PermissionResolver(db),
  ) {}

  /** The event's project, if the principal may see the event now (notification links, T-41, T-93). */
  async viewableProject(
    principal: Principal,
    companyId: string,
    eventId: string,
  ): Promise<string | null> {
    const row = await this.db
      .select()
      .from(safetyEvent)
      .where(
        and(eq(safetyEvent.companyId, companyId), eq(safetyEvent.id, eventId)),
      )
      .get();
    if (!row) return null;
    const granted = await this.resolver.projectPermissions(
      principal.userId,
      companyId,
      row.projectId,
    );
    if (!granted.has("projects.view")) return null;
    if (
      granted.has("projects.safety_events.view") ||
      row.reportedBy === principal.userId
    )
      return row.projectId;
    const team = await this.db
      .select({ id: safetyEventInvestigation.id })
      .from(safetyEventInvestigation)
      .where(
        and(
          eq(safetyEventInvestigation.eventId, row.id),
          sql`(${safetyEventInvestigation.leadId} = ${principal.userId} or exists (select 1 from safety_event_investigation_member m where m.investigation_id = ${safetyEventInvestigation.id} and m.user_id = ${principal.userId} and m.removed_at is null))`,
        ),
      )
      .get();
    return team ? row.projectId : null;
  }

  async summaryForProject(
    companyId: string,
    projectId: string,
    today: string,
  ): Promise<SafetyEventCountsDto> {
    const base = and(
      eq(safetyEvent.companyId, companyId),
      eq(safetyEvent.projectId, projectId),
      isNull(safetyEvent.voidedAt),
    );
    const row = await this.db
      .select({
        open: sql<number>`sum(case when ${safetyEvent.status} <> 'closed' then 1 else 0 end)`,
        criticalHigh: sql<number>`sum(case when ${safetyEvent.status} <> 'closed' and coalesce(${safetyEvent.severity}, ${safetyEvent.reportedSeverity}) in ('high','critical') then 1 else 0 end)`,
        toReview: sql<number>`sum(case when ${safetyEvent.status} = 'reported' then 1 else 0 end)`,
        verification: sql<number>`sum(case when ${safetyEvent.status} = 'verification' then 1 else 0 end)`,
      })
      .from(safetyEvent)
      .where(base)
      .get();
    const overdue = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(safetyEvent)
      .innerJoin(
        safetyEventInvestigation,
        eq(safetyEventInvestigation.eventId, safetyEvent.id),
      )
      .where(
        and(
          base,
          eq(safetyEvent.status, "under_investigation"),
          lt(safetyEventInvestigation.dueOn, today),
        ),
      )
      .get();
    return {
      open: row?.open ?? 0,
      criticalHigh: row?.criticalHigh ?? 0,
      toReview: row?.toReview ?? 0,
      overdueInvestigations: overdue?.n ?? 0,
      verification: row?.verification ?? 0,
    };
  }
}
