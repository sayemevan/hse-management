/**
 * Inspection module — public contract (Sprint 10: PLT-32, US-031 – US-039; D-59, D-60).
 *
 * Purpose: the one inspection engine (Doc 10). Company templates with immutable published
 * versions (T-76); project inspections pinned to one version (T-77) with the D-12 workflow
 * (T-78), capture with photos online and offline (T-80, T-83), scoring (T-81), findings and
 * corrective actions through the action engine (T-79).
 * Dependencies: identity (permissions, audiences, names), project (projects, places, record
 * numbers, the project guard), action (`ActionEngine`, `ActionDirectory`, the source registry),
 * company (time zones for the daily job), subscription (storage), platform/audit-log, activity,
 * notification, reminders, file-storage, comment, sync.
 */
import { and, eq, or } from 'drizzle-orm';

import { registerSyncEntity } from '../../platform/sync';
import { registerActionSource } from '../action';
import { ProjectDirectory, registerPlaceUsage } from '../project';
import { inspection, inspectionFinding } from './inspection.schema';
import { inspectionItemSyncEntity, inspectionSyncEntity } from './inspection-sync';
import { onFindingActionChanged } from './inspection-workflow';

// T-39: a place used by any inspection (cancelled included) can't be deleted.
registerPlaceUsage({
  module: 'inspection',
  async countRecordsUsing(db, placeId) {
    const rows = await db
      .select({ id: inspection.id })
      .from(inspection)
      .where(or(eq(inspection.areaId, placeId), eq(inspection.locationId, placeId), eq(inspection.workZoneId, placeId)))
      .limit(1)
      .all();
    return rows.length;
  },
});

// T-79: actions raised from findings link back to the finding and its inspection.
registerActionSource({
  module: 'inspection',
  async describe(db, companyId, findingId) {
    const found = await db
      .select({ finding: inspectionFinding, parent: inspection })
      .from(inspectionFinding)
      .innerJoin(inspection, eq(inspection.id, inspectionFinding.inspectionId))
      .where(and(eq(inspectionFinding.companyId, companyId), eq(inspectionFinding.id, findingId)))
      .get();
    if (!found) return null;
    const project = await new ProjectDirectory(db).get(companyId, found.parent.projectId);
    if (!project) return null;
    const reference = `${project.code}-INS-${String(found.parent.number).padStart(4, '0')}`;
    return {
      label: `${reference} · Finding ${String(found.finding.seq)}`,
      href: `/projects/${project.id}/inspections/${found.parent.id}#finding-${found.finding.id}`,
      projectId: project.id,
    };
  },
  onActionChanged: onFindingActionChanged,
});

registerSyncEntity(inspectionSyncEntity);
registerSyncEntity(inspectionItemSyncEntity);

export { InspectionDirectory } from './inspection-directory';
export { inspectionDueJob } from './due.job';
export {
  inspectionCategoryRoutes,
  inspectionMeRoutes,
  inspectionTemplateRoutes,
  projectInspectionRoutes,
} from './inspection.routes';
export { inspection } from './inspection.schema';
