/**
 * Safety event module — public contract (Sprint 11: PLT-33, US-040 – US-046; D-62, D-63).
 *
 * Purpose: the one safety event engine (Doc 11): hazards, near misses and incidents in one model
 * (T-84), types and lists as company data (T-85), the workflow as data (T-86), the investigation
 * stored apart (T-88), actions raised from recommendations through the action engine (T-89),
 * offline reporting (T-90), sensitive people data kept apart (T-92) and one access rule (T-93).
 * Dependencies: identity (permissions, audiences, names), project (projects, places, record
 * numbers, the project guard), action (`ActionEngine`, `ActionDirectory`, the source registry),
 * risk (`RiskMatrixDirectory`), workforce (`WorkforceDirectory`), company (time zones for the
 * daily job), subscription (storage), platform/audit-log, activity, notification, reminders,
 * file-storage, comment, sync.
 */
import { and, eq, isNull, or } from "drizzle-orm";

import { registerSyncEntity } from "../../platform/sync";
import { registerActionSource } from "../action";
import { PermissionResolver } from "../identity";
import { ProjectDirectory, registerPlaceUsage } from "../project";
import {
  safetyEvent,
  safetyEventInvestigation,
  safetyEventInvestigationMember,
  safetyEventRecommendation,
} from "./safety-event.schema";
import { mayView, safetyEventAccess } from "./safety-event.service";
import { safetyEventSyncEntity } from "./safety-event-sync";
import { onRecommendationActionChanged } from "./safety-event-workflow";

// T-39: a place used by any event (voided included) can't be deleted.
registerPlaceUsage({
  module: "safety_event",
  async countRecordsUsing(db, placeId) {
    const rows = await db
      .select({ id: safetyEvent.id })
      .from(safetyEvent)
      .where(
        or(
          eq(safetyEvent.areaId, placeId),
          eq(safetyEvent.locationId, placeId),
          eq(safetyEvent.workZoneId, placeId),
        ),
      )
      .limit(1)
      .all();
    return rows.length;
  },
});

// T-89: actions raised from recommendations link back to the recommendation and its event.
registerActionSource({
  module: "safety_event",
  async describe(db, companyId, recommendationId) {
    const found = await db
      .select({
        recommendation: safetyEventRecommendation,
        parent: safetyEvent,
      })
      .from(safetyEventRecommendation)
      .innerJoin(
        safetyEvent,
        eq(safetyEvent.id, safetyEventRecommendation.eventId),
      )
      .where(
        and(
          eq(safetyEventRecommendation.companyId, companyId),
          eq(safetyEventRecommendation.id, recommendationId),
        ),
      )
      .get();
    if (!found) return null;
    const project = await new ProjectDirectory(db).get(
      companyId,
      found.parent.projectId,
    );
    if (!project) return null;
    const reference = `${project.code}-EVT-${String(found.parent.number).padStart(4, "0")}`;
    return {
      label: `${reference} · Recommendation ${String(found.recommendation.seq)}`,
      href: `/projects/${project.id}/safety-events/${found.parent.id}#recommendation-${found.recommendation.id}`,
      projectId: project.id,
    };
  },
  // T-93: the action of an event is visible to whoever may see the event, not to its reporter alone.
  async canView(db, principal, recommendationId) {
    const found = await db
      .select({ parent: safetyEvent })
      .from(safetyEventRecommendation)
      .innerJoin(
        safetyEvent,
        eq(safetyEvent.id, safetyEventRecommendation.eventId),
      )
      .where(eq(safetyEventRecommendation.id, recommendationId))
      .get();
    if (!found) return false;
    const resolver = new PermissionResolver(db);
    const granted = await resolver.projectPermissions(
      principal.userId,
      found.parent.companyId,
      found.parent.projectId,
    );
    const investigation =
      (await db
        .select()
        .from(safetyEventInvestigation)
        .where(eq(safetyEventInvestigation.eventId, found.parent.id))
        .get()) ?? null;
    const members = investigation
      ? (
          await db
            .select({ userId: safetyEventInvestigationMember.userId })
            .from(safetyEventInvestigationMember)
            .where(
              and(
                eq(
                  safetyEventInvestigationMember.investigationId,
                  investigation.id,
                ),
                isNull(safetyEventInvestigationMember.removedAt),
              ),
            )
            .all()
        ).map((m) => m.userId)
      : [];
    const access = safetyEventAccess(
      principal.userId,
      granted,
      found.parent,
      investigation,
      members,
      false,
    );
    return mayView(access) && (access.viewer || access.team || access.manage);
  },
  onActionChanged: onRecommendationActionChanged,
});

registerSyncEntity(safetyEventSyncEntity);

export { safetyEventDueJob } from "./due.job";
export { SafetyEventDirectory } from "./safety-event-directory";
export {
  projectSafetyEventRoutes,
  safetyEventMeRoutes,
  safetyEventSettingsRoutes,
} from "./safety-event.routes";
export { safetyEvent } from "./safety-event.schema";
