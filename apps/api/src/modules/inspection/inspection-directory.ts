import { and, eq } from 'drizzle-orm';

import type { Principal } from '../../core/auth/principal';
import type { Database } from '../../database/client';
import type { PermissionResolver } from '../identity';
import { ProjectDirectory } from '../project';
import { inspection } from './inspection.schema';

/** What other modules may know about inspections (notification links, T-41). */
export class InspectionDirectory {
  constructor(
    private readonly db: Database,
    private readonly resolver: PermissionResolver,
  ) {}

  /** The inspection's project, if the principal may view the inspection now. */
  async viewableProject(principal: Principal, companyId: string, inspectionId: string): Promise<string | null> {
    const row = await this.db
      .select()
      .from(inspection)
      .where(and(eq(inspection.companyId, companyId), eq(inspection.id, inspectionId)))
      .get();
    if (!row) return null;
    const project = await new ProjectDirectory(this.db).get(companyId, row.projectId);
    if (!project) return null;
    const granted = await this.resolver.projectPermissions(principal.userId, companyId, project.id);
    if (!granted.has('projects.view')) return null;
    const visible =
      granted.has('projects.inspections.view') ||
      row.inspectorId === principal.userId ||
      row.plannedBy === principal.userId;
    return visible ? project.id : null;
  }
}
