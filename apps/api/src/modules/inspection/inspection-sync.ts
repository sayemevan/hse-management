import {
  INSPECTION_CONFLICT_FIELDS,
  INSPECTION_ENTITY,
  INSPECTION_ITEM_CONFLICT_FIELDS,
  INSPECTION_ITEM_ENTITY,
  itemResultRequestSchema,
  updateInspectionRequestSchema,
} from '@hse/shared';
import { and, eq } from 'drizzle-orm';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import type { Database } from '../../database/client';
import type { PrepareUpdateInput, SyncEntity, SyncSnapshot } from '../../platform/sync';
import { CompanyRepository } from '../company';
import { PermissionResolver } from '../identity';
import { ProjectDirectory } from '../project';
import { InspectionContext } from './inspection-context';
import { inspection, inspectionItemResult } from './inspection.schema';

/** The pieces a conflict resolution needs, loaded without a request. */
async function loadFor(input: { db: Database; companyId: string; principal: Principal; now: number; meta: PrepareUpdateInput['meta'] }, inspectionId: string) {
  const { db, companyId } = input;
  const row = await db
    .select()
    .from(inspection)
    .where(and(eq(inspection.companyId, companyId), eq(inspection.id, inspectionId)))
    .get();
  if (!row) throw new NotFoundError();
  const project = await new ProjectDirectory(db).get(companyId, row.projectId);
  if (!project) throw new NotFoundError();
  const [company] = await new CompanyRepository(db).findManyByIds([companyId]);
  const tenant = {
    id: companyId,
    timeZone: company?.timeZone ?? 'UTC',
    defaultLanguage: company?.defaultLanguage ?? 'en',
  } as TenantCompany;
  const resolver = new PermissionResolver(db, () => input.now);
  const { InspectionService } = await import('./inspection.service');
  const service = new InspectionService(
    new InspectionContext({ db, meta: input.meta, clock: () => input.now, resolver }),
  );
  const loaded = await service.load(tenant, project, input.principal, row.id);
  return { service, loaded, tenant };
}

function issues(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): ValidationError {
  return new ValidationError(
    error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
  );
}

/** T-80: the inspection header as a sync entity (place, date, weather, notes). */
export const inspectionSyncEntity: SyncEntity = {
  type: INSPECTION_ENTITY,
  conflictFields: INSPECTION_CONFLICT_FIELDS,
  async snapshot(db, companyId, entityId): Promise<SyncSnapshot | undefined> {
    const row = await db
      .select()
      .from(inspection)
      .where(and(eq(inspection.companyId, companyId), eq(inspection.id, entityId)))
      .get();
    if (!row) return undefined;
    const project = await new ProjectDirectory(db).get(companyId, row.projectId);
    const code = project?.code ?? '';
    const { InspectionService } = await import('./inspection.service');
    return new InspectionService(
      new InspectionContext({
        db,
        meta: { requestId: 'inspection-job', ipAddress: null, userAgent: null },
        clock: Date.now,
        resolver: new PermissionResolver(db),
      }),
    ).headerSnapshot(row, code);
  },
  async prepareUpdate(input) {
    const parsed = updateInspectionRequestSchema.omit({ baseVersion: true }).safeParse(input.values);
    if (!parsed.success) throw issues(parsed.error);
    const { service, loaded, tenant } = await loadFor(input, input.entityId);
    if (loaded.row.inspectorId !== input.principal.userId) throw new NotFoundError();
    return service.prepareHeader(tenant, loaded, input.principal, parsed.data, input.expectVersion, undefined, input.offline);
  },
};

function splitId(entityId: string): { inspectionId: string; itemKey: string } {
  const [inspectionId, itemKey] = entityId.split(':');
  if (!inspectionId || !itemKey) throw new NotFoundError();
  return { inspectionId, itemKey };
}

/** T-80: one item result as a sync entity (`{inspectionId}:{itemKey}`). */
export const inspectionItemSyncEntity: SyncEntity = {
  type: INSPECTION_ITEM_ENTITY,
  conflictFields: INSPECTION_ITEM_CONFLICT_FIELDS,
  async snapshot(db, companyId, entityId): Promise<SyncSnapshot | undefined> {
    const { inspectionId, itemKey } = splitId(entityId);
    const row = await db
      .select()
      .from(inspection)
      .where(and(eq(inspection.companyId, companyId), eq(inspection.id, inspectionId)))
      .get();
    const item = await db
      .select()
      .from(inspectionItemResult)
      .where(and(eq(inspectionItemResult.inspectionId, inspectionId), eq(inspectionItemResult.itemKey, itemKey)))
      .get();
    if (!row || !item) return undefined;
    const project = await new ProjectDirectory(db).get(companyId, row.projectId);
    const { InspectionService } = await import('./inspection.service');
    const service = new InspectionService(
      new InspectionContext({
        db,
        meta: { requestId: 'inspection-job', ipAddress: null, userAgent: null },
        clock: Date.now,
        resolver: new PermissionResolver(db),
      }),
    );
    const { inspectionTemplateVersion } = await import('./inspection.schema');
    const version = await db
      .select()
      .from(inspectionTemplateVersion)
      .where(eq(inspectionTemplateVersion.id, row.templateVersionId))
      .get();
    if (!version) return undefined;
    return service.itemSnapshot(item, {
      row,
      project: { id: row.projectId, code: project?.code ?? '', status: project?.status ?? 'active' },
      version,
    });
  },
  async prepareUpdate(input) {
    const parsed = itemResultRequestSchema.omit({ baseVersion: true }).safeParse(input.values);
    if (!parsed.success) throw issues(parsed.error);
    const { inspectionId, itemKey } = splitId(input.entityId);
    const { service, loaded } = await loadFor(input, inspectionId);
    if (loaded.row.inspectorId !== input.principal.userId || loaded.row.status !== 'in_progress') {
      throw new NotFoundError();
    }
    const existing =
      (await input.db
        .select()
        .from(inspectionItemResult)
        .where(and(eq(inspectionItemResult.inspectionId, inspectionId), eq(inspectionItemResult.itemKey, itemKey)))
        .get()) ?? null;
    return service.prepareItem(
      loaded,
      input.principal,
      itemKey,
      existing,
      parsed.data,
      undefined,
      input.offline,
      input.expectVersion,
    );
  },
};
