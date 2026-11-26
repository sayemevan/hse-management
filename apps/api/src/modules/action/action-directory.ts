import type { ActionStatus } from '@hse/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Principal } from '../../core/auth/principal';
import type { Database } from '../../database/client';
import type { PermissionResolver } from '../identity';
import { ProjectDirectory } from '../project';
import { mayView } from './action-access';
import { ActionRepository } from './action.repository';
import { action } from './action.schema';

/**
 * What other modules may know about actions (PLT-23 FR-2): counts by status for their source
 * records, and whether a reader may open one (notification links, T-41).
 */
export class ActionDirectory {
  constructor(
    private readonly db: Database,
    private readonly resolver: PermissionResolver,
  ) {}

  async summaryForSource(
    companyId: string,
    module: string,
    recordIds: readonly string[],
  ): Promise<Map<string, Partial<Record<ActionStatus, number>>>> {
    const result = new Map<string, Partial<Record<ActionStatus, number>>>();
    if (recordIds.length === 0) return result;
    const rows = await this.db
      .select({
        recordId: action.sourceRecordId,
        status: action.status,
        count: sql<number>`count(*)`,
      })
      .from(action)
      .where(
        and(
          eq(action.companyId, companyId),
          eq(action.sourceModule, module),
          inArray(action.sourceRecordId, [...recordIds]),
          isNull(action.voidedAt),
        ),
      )
      .groupBy(action.sourceRecordId, action.status)
      .all();
    for (const row of rows) {
      if (!row.recordId) continue;
      const entry = result.get(row.recordId) ?? {};
      entry[row.status] = row.count;
      result.set(row.recordId, entry);
    }
    return result;
  }

  /** The action's project, if the principal may view the action now (T-65). */
  async viewableProject(
    principal: Principal,
    companyId: string,
    actionId: string,
  ): Promise<string | null> {
    const [row] = await new ActionRepository(this.db).findMany(companyId, [actionId]);
    if (!row) return null;
    const project = await new ProjectDirectory(this.db).get(companyId, row.projectId);
    if (!project) return null;
    const collaborators = (await new ActionRepository(this.db).collaboratorsOf([row.id])).map(
      (c) => c.userId,
    );
    const granted = await this.resolver.projectPermissions(principal.userId, companyId, project.id);
    const visible = await mayView(
      this.db,
      principal,
      { userId: principal.userId, granted, archived: project.status === 'archived' },
      row,
      collaborators,
    );
    return visible ? project.id : null;
  }
}
