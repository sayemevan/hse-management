import {
  acceptsRecords,
  ACTIVITY_ACTIONS,
  type ActivityEntryDto,
  addIsoDays,
  allItems,
  allowedInspectionTransitions,
  COMMENT_LIMITS,
  type CommentDto,
  type CommentPageDto,
  type CreateInspectionRequest,
  createInspectionRequestSchema,
  type FindingDto,
  type FindingListQuery,
  type FindingPageDto,
  generateId,
  INSPECTION_FILE_RULES,
  INSPECTION_LIMITS,
  type InspectionActorFacts,
  type InspectionCountsDto,
  type InspectionDto,
  type InspectionFileDto,
  type InspectionItemDto,
  type InspectionListQuery,
  inspectionOverdueDays,
  type InspectionPageDto,
  inspectionReadiness,
  inspectionReference,
  type InspectionStatus,
  inspectionStep,
  type InspectionSummaryDto,
  type InspectionTransitionRequest,
  inspectionTransitionRequestSchema,
  type ItemResultRequest,
  itemResultRequestSchema,
  localized,
  type MyInspectionsPageDto,
  type MyInspectionsQuery,
  parseInspectionNumber,
  type PersonRefDto,
  type PlaceSelection,
  type ReadinessDto,
  type RaiseFindingActionRequest,
  scoreInspection,
  type TemplateContent,
  type TimelinePageDto,
  type UpdateFindingRequest,
  type UpdateInspectionRequest,
  updateInspectionRequestSchema,
} from '@hse/shared';
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import type { IdempotencyClaim } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../../core/errors/app-error';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { parseActivityCursor } from '../../platform/activity';
import { type CommentTarget, parseCommentCursor } from '../../platform/comment';
import type { OpenedFile } from '../../platform/file-storage';
import {
  isVersionGuardFailure,
  offlineAudit,
  type OfflineMeta,
  type PreparedUpdate,
  RecordIdTakenError,
  SyncConflictError,
  SyncConflictService,
  type SyncSnapshot,
} from '../../platform/sync';
import { ActionContext, ActionDirectory, ActionEngine, withActionNumber } from '../action';
import { userSummaries } from '../identity';
import { ProjectArchivedError, type ProjectRow, withRecordNumber } from '../project';
import { InspectionContext, type InspectionProject } from './inspection-context';
import {
  FindingLockedError,
  InspectionFileLimitError,
  InspectionLockedError,
  InspectionTransitionError,
  InspectorNotEligibleError,
  ItemUnknownError,
  NotInspectorError,
  PlaceRequiredError,
  ProjectNotAcceptingRecordsError,
  SelfApprovalError,
  TemplateRetiredError,
  TemplateVersionNotAllowedError,
} from './inspection.errors';
import {
  inspection,
  inspectionFile,
  type InspectionFileRow,
  inspectionFinding,
  type InspectionFindingRow,
  inspectionItemResult,
  type InspectionItemResultRow,
  type InspectionRow,
  inspectionTemplate,
  type InspectionTemplateRow,
  inspectionTemplateVersion,
  type InspectionTemplateVersionRow,
} from './inspection.schema';
import { inspectionItemSyncEntity, inspectionSyncEntity } from './inspection-sync';
import { InspectionWorkflow } from './inspection-workflow';

export const INSPECTION_NUMBER_INDEX = 'inspection.project_id, inspection.number';
const DAY_MS = 24 * 60 * 60 * 1000;
/** SQLite raises this for `json('…')`: a guard of the batch failed (T-58 pattern). */
const GUARD = 'malformed JSON';

export interface Viewer {
  userId: string;
  granted: ReadonlySet<string>;
  archived: boolean;
}

export interface Loaded {
  row: InspectionRow;
  version: InspectionTemplateVersionRow;
  template: InspectionTemplateRow;
  project: InspectionProject;
  viewer: Viewer;
}

type ProjectArg = { id: string; code: string; status: string };
type CreateInput = z.output<typeof createInspectionRequestSchema>;
type UpdateInput = z.output<typeof updateInspectionRequestSchema>;
type ItemInput = z.output<typeof itemResultRequestSchema>;
type TransitionInput = z.output<typeof inspectionTransitionRequestSchema>;

/** A created or replayed inspection (T-68). */
export interface CreateResult {
  dto: InspectionDto;
  replayed: boolean;
}

function placeOf(row: Pick<InspectionRow, 'areaId' | 'locationId' | 'workZoneId'>): string | null {
  return row.workZoneId ?? row.locationId ?? row.areaId;
}

function isUnique(error: unknown, text: string): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return message.includes('UNIQUE') && message.includes(text);
}

/** PLT-32, US-033 – US-039: the inspection workflow, capture, files and findings. */
export class InspectionService {
  constructor(readonly ctx: InspectionContext) {}

  // ---- Loading and access ----------------------------------------------------------------

  private async viewer(tenant: TenantCompany, project: ProjectArg, principal: Principal): Promise<Viewer> {
    return {
      userId: principal.userId,
      granted: await this.ctx.projectPermissions(principal.userId, tenant.id, project.id),
      archived: project.status === 'archived',
    };
  }

  private visible(viewer: Viewer, row: InspectionRow): boolean {
    return (
      viewer.granted.has('projects.inspections.view') ||
      row.inspectorId === viewer.userId ||
      row.plannedBy === viewer.userId
    );
  }

  private facts(viewer: Viewer, row: InspectionRow): InspectionActorFacts {
    const conduct = viewer.granted.has('projects.inspections.conduct');
    return {
      inspector: row.inspectorId === viewer.userId && conduct,
      manage: viewer.granted.has('projects.inspections.manage'),
      approve: viewer.granted.has('projects.inspections.approve'),
      unplanned: row.plannedBy === null,
      reviewStarted: row.reviewStartedAt !== null,
      cancelled: row.cancelledAt !== null,
    };
  }

  async findRow(companyId: string, projectId: string, id: string): Promise<InspectionRow | undefined> {
    return this.ctx.db
      .select()
      .from(inspection)
      .where(and(eq(inspection.companyId, companyId), eq(inspection.projectId, projectId), eq(inspection.id, id)))
      .get();
  }

  private async templateParts(
    row: Pick<InspectionRow, 'templateId' | 'templateVersionId'>,
  ): Promise<{ template: InspectionTemplateRow; version: InspectionTemplateVersionRow }> {
    const [template, version] = await Promise.all([
      this.ctx.db.select().from(inspectionTemplate).where(eq(inspectionTemplate.id, row.templateId)).get(),
      this.ctx.db
        .select()
        .from(inspectionTemplateVersion)
        .where(eq(inspectionTemplateVersion.id, row.templateVersionId))
        .get(),
    ]);
    if (!template || !version) throw new NotFoundError();
    return { template, version };
  }

  async load(tenant: TenantCompany, project: ProjectArg, principal: Principal, id: string): Promise<Loaded> {
    const row = await this.findRow(tenant.id, project.id, id);
    if (!row) throw new NotFoundError();
    const viewer = await this.viewer(tenant, project, principal);
    if (!this.visible(viewer, row)) throw new NotFoundError();
    return { row, ...(await this.templateParts(row)), project, viewer };
  }

  private assertWritable(loaded: Loaded): void {
    if (loaded.viewer.archived) throw new ProjectArchivedError();
  }

  private assertCapturing(loaded: Loaded): void {
    this.assertWritable(loaded);
    const { row } = loaded;
    if (row.cancelledAt !== null || row.status !== 'in_progress') throw new InspectionLockedError();
    if (row.inspectorId !== loaded.viewer.userId) throw new NotInspectorError();
    if (!loaded.viewer.granted.has('projects.inspections.conduct')) throw new NotInspectorError();
  }

  private async canConduct(companyId: string, projectId: string, userId: string): Promise<boolean> {
    return (await this.ctx.projectPermissions(userId, companyId, projectId)).has(
      'projects.inspections.conduct',
    );
  }

  // ---- DTOs ------------------------------------------------------------------------------

  private async people(ids: readonly (string | null | undefined)[]): Promise<Map<string, PersonRefDto>> {
    const summaries = await userSummaries(
      this.ctx.db,
      ids.filter((id): id is string => typeof id === 'string'),
    );
    return new Map([...summaries].map(([id, s]) => [id, { id, name: s.fullName }]));
  }

  private async placeNames(
    companyId: string,
    projectId: string,
    rows: readonly InspectionRow[],
  ): Promise<Map<string, string>> {
    const ids = rows.map(placeOf).filter((id): id is string => id !== null);
    const resolved = await this.ctx.places.resolveMany(companyId, projectId, ids);
    return new Map([...resolved].map(([id, place]) => [id, place.names.join(' › ')]));
  }

  private async summaries(
    tenant: TenantCompany,
    rows: readonly InspectionRow[],
    projects: ReadonlyMap<string, InspectionProject>,
  ): Promise<InspectionSummaryDto[]> {
    if (rows.length === 0) return [];
    const today = this.ctx.today(tenant);
    const templateIds = [...new Set(rows.map((r) => r.templateId))];
    const versionIds = [...new Set(rows.map((r) => r.templateVersionId))];
    const [templates, versions, people, findingCounts] = await Promise.all([
      this.ctx.db.select().from(inspectionTemplate).where(inArray(inspectionTemplate.id, templateIds)).all(),
      this.ctx.db
        .select({ id: inspectionTemplateVersion.id, versionNo: inspectionTemplateVersion.versionNo })
        .from(inspectionTemplateVersion)
        .where(inArray(inspectionTemplateVersion.id, versionIds))
        .all(),
      this.people(rows.map((r) => r.inspectorId)),
      this.ctx.db
        .select({
          inspectionId: inspectionFinding.inspectionId,
          total: sql<number>`count(*)`,
          open: sql<number>`sum(case when ${inspectionFinding.status} in ('open','action_raised') then 1 else 0 end)`,
        })
        .from(inspectionFinding)
        .where(inArray(inspectionFinding.inspectionId, rows.map((r) => r.id)))
        .groupBy(inspectionFinding.inspectionId)
        .all(),
    ]);
    const byTemplate = new Map(templates.map((t) => [t.id, t]));
    const byVersion = new Map(versions.map((v) => [v.id, v.versionNo]));
    const findings = new Map(findingCounts.map((f) => [f.inspectionId, f]));
    const places = new Map<string, string>();
    for (const projectId of new Set(rows.map((r) => r.projectId))) {
      for (const [id, name] of await this.placeNames(
        tenant.id,
        projectId,
        rows.filter((r) => r.projectId === projectId),
      )) {
        places.set(id, name);
      }
    }
    return rows.map((row) => {
      const template = byTemplate.get(row.templateId);
      const project = projects.get(row.projectId);
      const code = project?.code ?? '';
      const placeId = placeOf(row);
      const counts = findings.get(row.id);
      return {
        id: row.id,
        number: row.number,
        reference: inspectionReference(code, row.number),
        projectId: row.projectId,
        projectCode: code,
        templateId: row.templateId,
        templateNameEn: template?.nameEn ?? null,
        templateNameAr: template?.nameAr ?? null,
        versionNo: byVersion.get(row.templateVersionId) ?? 0,
        status: row.status,
        cancelled: row.cancelledAt !== null,
        inspector: people.get(row.inspectorId) ?? { id: row.inspectorId, name: '' },
        plannedOn: row.plannedOn,
        inspectedOn: row.inspectedOn,
        placeName: placeId ? (places.get(placeId) ?? null) : null,
        scorePercent: row.scorePercent,
        scoreOutcome: row.scoreOutcome,
        findingCount: counts?.total ?? 0,
        openFindingCount: counts?.open ?? 0,
        overdueDays: inspectionOverdueDays(row.plannedOn, row.status, row.cancelledAt !== null, today),
        underReview: row.status === 'submitted' && row.reviewStartedAt !== null,
        offline: row.offline,
        updatedAt: row.updatedAt.getTime(),
      };
    });
  }

  private async items(inspectionId: string): Promise<InspectionItemResultRow[]> {
    return this.ctx.db
      .select()
      .from(inspectionItemResult)
      .where(eq(inspectionItemResult.inspectionId, inspectionId))
      .all();
  }

  private async fileRows(inspectionId: string): Promise<InspectionFileRow[]> {
    return this.ctx.db
      .select()
      .from(inspectionFile)
      .where(and(eq(inspectionFile.inspectionId, inspectionId), isNull(inspectionFile.removedAt)))
      .orderBy(asc(inspectionFile.createdAt), asc(inspectionFile.id))
      .all();
  }

  async findingRows(inspectionId: string): Promise<InspectionFindingRow[]> {
    return this.ctx.db
      .select()
      .from(inspectionFinding)
      .where(eq(inspectionFinding.inspectionId, inspectionId))
      .orderBy(asc(inspectionFinding.seq))
      .all();
  }

  private actions(): ActionDirectory {
    return new ActionDirectory(this.ctx.db, this.ctx.resolver);
  }

  async findingDtos(
    companyId: string,
    projectCode: string,
    rows: readonly InspectionFindingRow[],
    files: readonly InspectionFileRow[],
  ): Promise<FindingDto[]> {
    const actions = await this.actions().actionsForSource(
      companyId,
      'inspection',
      rows.map((r) => r.id),
    );
    const people = await this.people([...rows.map((r) => r.responsibleId), ...actions.map((a) => a.ownerId)]);
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      itemKey: row.itemKey,
      description: row.description,
      severity: row.severity,
      categoryEn: row.categoryEn,
      categoryAr: row.categoryAr,
      responsible: row.responsibleId ? (people.get(row.responsibleId) ?? null) : null,
      dueOn: row.dueOn,
      status: row.status,
      decision: row.decision,
      noActionReason: row.noActionReason,
      edited: row.editedAt !== null,
      actions: actions
        .filter((a) => a.recordId === row.id)
        .map((a) => ({
          id: a.id,
          reference: `${projectCode}-ACT-${String(a.number).padStart(4, '0')}`,
          status: a.status,
          voided: a.voided,
          ownerName: people.get(a.ownerId)?.name ?? '',
          dueOn: a.dueOn,
        })),
      photoIds: files.filter((f) => f.itemKey === row.itemKey).map((f) => f.id),
    }));
  }

  async toDto(tenant: TenantCompany, loaded: Loaded): Promise<InspectionDto> {
    const { row, version, project, viewer } = loaded;
    const [summary] = await this.summaries(tenant, [row], new Map([[project.id, project]]));
    if (!summary) throw new NotFoundError();
    const [itemRows, files, findingRows] = await Promise.all([
      this.items(row.id),
      this.fileRows(row.id),
      this.findingRows(row.id),
    ]);
    const people = await this.people([
      row.plannedBy,
      row.approvedBy,
      ...itemRows.map((i) => i.assignedTo),
    ]);
    const facts = this.facts(viewer, row);
    const followUp = row.followUpOf
      ? await this.ctx.db
          .select({ id: inspection.id, number: inspection.number })
          .from(inspection)
          .where(and(eq(inspection.companyId, row.companyId), eq(inspection.id, row.followUpOf)))
          .get()
      : undefined;
    const locked = row.cancelledAt !== null || viewer.archived;
    const items: InspectionItemDto[] = itemRows.map((item) => ({
      itemKey: item.itemKey,
      result: item.result,
      comment: item.comment,
      priority: item.priority,
      assignedTo: item.assignedTo ? (people.get(item.assignedTo) ?? null) : null,
      raiseFinding: item.raiseFinding,
      version: item.version,
    }));
    const submitCount = row.submitCount;
    const fileDtos = await this.fileDtos(files, row, submitCount);
    return {
      ...summary,
      templateVersionId: row.templateVersionId,
      content: version.content,
      planner: row.plannedBy ? (people.get(row.plannedBy) ?? null) : null,
      note: row.note,
      place: { areaId: row.areaId, locationId: row.locationId, workZoneId: row.workZoneId },
      weather: row.weather,
      notes: row.notes,
      location:
        row.latitude !== null && row.longitude !== null
          ? { latitude: row.latitude, longitude: row.longitude, accuracy: row.locationAccuracyM }
          : null,
      startedAt: row.startedAt?.getTime() ?? null,
      submittedAt: row.submittedAt?.getTime() ?? null,
      approvedAt: row.approvedAt?.getTime() ?? null,
      approvedBy: row.approvedBy ? (people.get(row.approvedBy) ?? null) : null,
      approvedOnSubmit: row.approvedOnSubmit,
      closedAt: row.closedAt?.getTime() ?? null,
      cancelReason: row.cancelReason,
      followUpOf: followUp
        ? { id: followUp.id, reference: inspectionReference(project.code, followUp.number) }
        : null,
      capturedAt: row.capturedAt?.getTime() ?? null,
      receivedAt: row.receivedAt.getTime(),
      items,
      files: fileDtos,
      findings: await this.findingDtos(row.companyId, project.code, findingRows, files),
      allowedTransitions: locked ? [] : allowedInspectionTransitions(row.status, facts),
      canCapture: !locked && row.status === 'in_progress' && facts.inspector,
      canEditFindings:
        !locked && row.status === 'submitted' && !facts.inspector && (facts.approve || facts.manage),
      canRaiseActions:
        !locked &&
        row.status === 'approved' &&
        (facts.approve || viewer.granted.has('projects.actions.create')),
      canComment: !viewer.archived && row.status !== 'closed' && row.cancelledAt === null,
      version: row.version,
    };
  }

  private async fileDtos(
    files: readonly InspectionFileRow[],
    row: InspectionRow,
    submitCount: number,
  ): Promise<InspectionFileDto[]> {
    if (files.length === 0) return [];
    const metas = await Promise.all(files.map((f) => this.ctx.files.find(f.fileId, row.companyId)));
    return files.map((file, index) => {
      const meta = metas[index];
      return {
        id: file.id,
        itemKey: file.itemKey,
        name: meta?.fileName ?? '',
        size: meta?.sizeBytes ?? 0,
        contentType: meta?.contentType ?? '',
        capturedAt: file.capturedAt.getTime(),
        uploadedBy: file.createdBy,
        removable:
          row.status === 'in_progress' &&
          row.cancelledAt === null &&
          file.submittedWith === null &&
          submitCount >= 0,
      };
    });
  }

  async detail(tenant: TenantCompany, project: ProjectArg, principal: Principal, id: string): Promise<InspectionDto> {
    return this.toDto(tenant, await this.load(tenant, project, principal, id));
  }

  // ---- Lists (US-033) --------------------------------------------------------------------

  private visibilityCondition(viewer: Viewer): SQL | undefined {
    if (viewer.granted.has('projects.inspections.view')) return undefined;
    return or(eq(inspection.inspectorId, viewer.userId), eq(inspection.plannedBy, viewer.userId));
  }

  async counts(tenant: TenantCompany, project: ProjectArg, viewer: Viewer): Promise<InspectionCountsDto> {
    const today = this.ctx.today(tenant);
    const visibility = this.visibilityCondition(viewer);
    const base = and(
      eq(inspection.companyId, tenant.id),
      eq(inspection.projectId, project.id),
      isNull(inspection.cancelledAt),
      visibility,
    );
    const row = await this.ctx.db
      .select({
        today: sql<number>`sum(case when ${inspection.status} in ('draft','in_progress') and ${inspection.plannedOn} = ${today} then 1 else 0 end)`,
        overdue: sql<number>`sum(case when ${inspection.status} in ('draft','in_progress') and ${inspection.plannedOn} < ${today} then 1 else 0 end)`,
        inProgress: sql<number>`sum(case when ${inspection.status} = 'in_progress' then 1 else 0 end)`,
        toReview: sql<number>`sum(case when ${inspection.status} = 'submitted' then 1 else 0 end)`,
      })
      .from(inspection)
      .where(base)
      .get();
    const findings = await this.ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(inspectionFinding)
      .innerJoin(inspection, eq(inspection.id, inspectionFinding.inspectionId))
      .where(
        and(
          eq(inspectionFinding.projectId, project.id),
          eq(inspectionFinding.companyId, tenant.id),
          inArray(inspectionFinding.status, ['open', 'action_raised']),
          inArray(inspection.status, ['approved', 'closed']),
          visibility,
        ),
      )
      .get();
    return {
      today: row?.today ?? 0,
      overdue: row?.overdue ?? 0,
      inProgress: row?.inProgress ?? 0,
      toReview: row?.toReview ?? 0,
      openFindings: findings?.n ?? 0,
    };
  }

  async list(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    query: InspectionListQuery,
  ): Promise<InspectionPageDto> {
    const viewer = await this.viewer(tenant, project, principal);
    const today = this.ctx.today(tenant);
    const conditions: (SQL | undefined)[] = [
      eq(inspection.companyId, tenant.id),
      eq(inspection.projectId, project.id),
      this.visibilityCondition(viewer),
    ];
    if (!query.cancelled) conditions.push(isNull(inspection.cancelledAt));
    if (query.status.length > 0) conditions.push(inArray(inspection.status, query.status));
    switch (query.filter) {
      case 'today':
        conditions.push(inArray(inspection.status, ['draft', 'in_progress']), eq(inspection.plannedOn, today));
        break;
      case 'overdue':
        conditions.push(inArray(inspection.status, ['draft', 'in_progress']), lt(inspection.plannedOn, today));
        break;
      case 'in_progress':
        conditions.push(eq(inspection.status, 'in_progress'));
        break;
      case 'to_review':
        conditions.push(eq(inspection.status, 'submitted'));
        break;
      case 'mine':
        conditions.push(eq(inspection.inspectorId, viewer.userId));
        break;
      default:
        break;
    }
    if (query.template) conditions.push(eq(inspection.templateId, query.template));
    if (query.inspector) conditions.push(eq(inspection.inspectorId, query.inspector));
    if (query.place) {
      conditions.push(
        or(
          eq(inspection.areaId, query.place),
          eq(inspection.locationId, query.place),
          eq(inspection.workZoneId, query.place),
        ),
      );
    }
    const dateOf = sql`coalesce(${inspection.inspectedOn}, ${inspection.plannedOn})`;
    if (query.from) conditions.push(sql`${dateOf} >= ${query.from}`);
    if (query.to) conditions.push(sql`${dateOf} <= ${query.to}`);
    if (query.search) {
      const number = parseInspectionNumber(query.search);
      if (number !== null) conditions.push(eq(inspection.number, number));
    }
    const where = and(...conditions);
    const [rows, total] = await Promise.all([
      this.ctx.db
        .select()
        .from(inspection)
        .where(where)
        .orderBy(
          sql`case when ${inspection.status} in ('draft','in_progress') then 0 else 1 end`,
          asc(sql`coalesce(${inspection.plannedOn}, '9999-12-31')`),
          desc(inspection.updatedAt),
        )
        .limit(query.limit)
        .offset(query.offset)
        .all(),
      this.ctx.db.select({ n: sql<number>`count(*)` }).from(inspection).where(where).get(),
    ]);
    return {
      items: await this.summaries(tenant, rows, new Map([[project.id, project]])),
      total: total?.n ?? 0,
      counts: await this.counts(tenant, project, viewer),
      canPlan: !viewer.archived && viewer.granted.has('projects.inspections.manage'),
      canStart: !viewer.archived && viewer.granted.has('projects.inspections.conduct'),
    };
  }

  /** US-033: My inspections across the user's projects. */
  async mine(
    tenant: TenantCompany,
    principal: Principal,
    query: MyInspectionsQuery,
    projects: (ids: readonly string[]) => Promise<Map<string, InspectionProject>>,
  ): Promise<MyInspectionsPageDto> {
    const approve = await this.ctx.resolver.projectAccess(
      principal.userId,
      tenant.id,
      'projects.inspections.approve',
    );
    const reviewScope =
      approve.allProjects
        ? undefined
        : approve.projectIds.length > 0
          ? inArray(inspection.projectId, approve.projectIds)
          : sql`0`;
    const conditionsFor = (tab: MyInspectionsQuery['tab']) => {
      const common = [eq(inspection.companyId, tenant.id), isNull(inspection.cancelledAt)];
      switch (tab) {
        case 'assigned':
          return and(...common, eq(inspection.inspectorId, principal.userId), eq(inspection.status, 'draft'));
        case 'in_progress':
          return and(
            ...common,
            eq(inspection.inspectorId, principal.userId),
            eq(inspection.status, 'in_progress'),
          );
        case 'to_review':
          return and(
            ...common,
            eq(inspection.status, 'submitted'),
            ne(inspection.inspectorId, principal.userId),
            reviewScope,
          );
      }
    };
    const count = async (tab: MyInspectionsQuery['tab']) =>
      (await this.ctx.db.select({ n: sql<number>`count(*)` }).from(inspection).where(conditionsFor(tab)).get())
        ?.n ?? 0;
    const rows = await this.ctx.db
      .select()
      .from(inspection)
      .where(conditionsFor(query.tab))
      .orderBy(asc(sql`coalesce(${inspection.plannedOn}, '9999-12-31')`), desc(inspection.updatedAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const [assigned, inProgress, toReview] = await Promise.all([
      count('assigned'),
      count('in_progress'),
      count('to_review'),
    ]);
    const projectMap = await projects([...new Set(rows.map((r) => r.projectId))]);
    // Archived projects and projects the user can no longer view drop out.
    const visible = rows.filter((r) => projectMap.has(r.projectId));
    return {
      items: await this.summaries(tenant, visible, projectMap),
      total: query.tab === 'assigned' ? assigned : query.tab === 'in_progress' ? inProgress : toReview,
      counts: { assigned, inProgress, toReview },
    };
  }

  // ---- Create: plan and start (US-033) ---------------------------------------------------

  private async activeTemplate(companyId: string, templateId: string): Promise<InspectionTemplateRow> {
    const template = await this.ctx.db
      .select()
      .from(inspectionTemplate)
      .where(and(eq(inspectionTemplate.companyId, companyId), eq(inspectionTemplate.id, templateId)))
      .get();
    if (!template?.currentVersionId) throw new NotFoundError();
    return template;
  }

  /** O-147: the version an inspection may start on. */
  private async startVersion(
    companyId: string,
    versionId: string,
    capturedAt: number,
    offline: boolean,
  ): Promise<{ template: InspectionTemplateRow; version: InspectionTemplateVersionRow }> {
    const version = await this.ctx.db
      .select()
      .from(inspectionTemplateVersion)
      .where(and(eq(inspectionTemplateVersion.companyId, companyId), eq(inspectionTemplateVersion.id, versionId)))
      .get();
    if (!version || version.state === 'draft') throw new NotFoundError();
    const template = await this.activeTemplate(companyId, version.templateId).catch(() => null);
    if (!template) throw new NotFoundError();
    const grace = INSPECTION_LIMITS.supersededGraceDays * DAY_MS;
    if (template.status === 'retired') {
      const retiredAt = template.retiredAt?.getTime() ?? 0;
      if (!offline || capturedAt > retiredAt || this.ctx.now() - retiredAt > grace) {
        throw new TemplateRetiredError();
      }
    }
    if (version.state === 'superseded') {
      const supersededAt = version.supersededAt?.getTime() ?? 0;
      const startedWhilePublished = offline && capturedAt <= supersededAt;
      const withinGrace = offline && this.ctx.now() - supersededAt <= grace;
      if (!startedWhilePublished && !withinGrace) throw new TemplateVersionNotAllowedError();
    }
    return { template, version };
  }

  private async placeFields(
    tenant: TenantCompany,
    projectId: string,
    selection: PlaceSelection | null | undefined,
    areaRequired: boolean,
    allowInactiveIds: readonly string[] = [],
  ): Promise<{ areaId: string | null; locationId: string | null; workZoneId: string | null }> {
    const place = selection ?? {};
    if (areaRequired && !place.areaId) throw new PlaceRequiredError();
    const issues = await this.ctx.places.validateSelection(tenant.id, projectId, place, {
      allowInactiveIds,
    });
    if (issues.length > 0) {
      throw new ValidationError(issues.map((issue) => ({ ...issue, path: `place.${issue.path}` })));
    }
    return {
      areaId: place.areaId ?? null,
      locationId: place.locationId ?? null,
      workZoneId: place.workZoneId ?? null,
    };
  }

  async create(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    input: CreateInput,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<CreateResult> {
    const viewer = await this.viewer(tenant, project, principal);
    if (viewer.archived) throw new ProjectArchivedError();
    if (!acceptsRecords(project.status as Parameters<typeof acceptsRecords>[0])) {
      throw new ProjectNotAcceptingRecordsError(project.status);
    }
    const now = this.ctx.now();
    const capturedAt = offline?.capturedAt ?? now;
    const today = this.ctx.today(tenant);

    let template: InspectionTemplateRow;
    let version: InspectionTemplateVersionRow;
    let values: Partial<InspectionRow>;
    let audit: 'inspection.planned' | 'inspection.started';
    if (input.mode === 'plan') {
      if (!viewer.granted.has('projects.inspections.manage')) throw new ForbiddenError();
      template = await this.activeTemplate(tenant.id, input.templateId);
      if (template.status === 'retired') throw new TemplateRetiredError();
      const current = await this.ctx.db
        .select()
        .from(inspectionTemplateVersion)
        .where(eq(inspectionTemplateVersion.id, template.currentVersionId ?? ''))
        .get();
      if (!current) throw new NotFoundError();
      version = current;
      if (!(await this.canConduct(tenant.id, project.id, input.inspectorId))) {
        throw new InspectorNotEligibleError();
      }
      if (input.plannedOn < today || input.plannedOn > addIsoDays(today, INSPECTION_LIMITS.planDaysMax)) {
        throw new ValidationError([{ path: 'plannedOn', message: 'invalidDate' }]);
      }
      values = {
        status: 'draft',
        inspectorId: input.inspectorId,
        plannedBy: principal.userId,
        plannedOn: input.plannedOn,
        note: input.note ?? null,
        ...(await this.placeFields(tenant, project.id, input.place, false)),
      };
      audit = 'inspection.planned';
    } else {
      if (!viewer.granted.has('projects.inspections.conduct')) throw new ForbiddenError();
      if (input.id) {
        const existing = await this.ctx.db.select().from(inspection).where(eq(inspection.id, input.id)).get();
        if (existing) {
          if (existing.companyId === tenant.id && existing.createdBy === principal.userId) {
            const loaded = await this.load(tenant, project, principal, existing.id);
            return { dto: await this.toDto(tenant, loaded), replayed: true };
          }
          throw new RecordIdTakenError();
        }
      }
      ({ template, version } = await this.startVersion(
        tenant.id,
        input.templateVersionId,
        capturedAt,
        offline !== null,
      ));
      const inspectedOn = input.inspectedOn ?? today;
      if (inspectedOn > addIsoDays(today, 1)) {
        throw new ValidationError([{ path: 'inspectedOn', message: 'future' }]);
      }
      let followUpOf: string | null = null;
      if (input.followUpOf) {
        const previous = await this.findRow(tenant.id, project.id, input.followUpOf);
        if (!previous || (previous.status !== 'approved' && previous.status !== 'closed')) {
          throw new ValidationError([{ path: 'followUpOf', message: 'invalid' }]);
        }
        followUpOf = previous.id;
      }
      values = {
        status: 'in_progress',
        inspectorId: principal.userId,
        plannedBy: null,
        plannedOn: null,
        ...(await this.placeFields(tenant, project.id, input.place, version.content.areaRequired)),
        inspectedOn,
        weather: input.weather ?? null,
        notes: input.notes ?? null,
        latitude: input.location?.latitude ?? null,
        longitude: input.location?.longitude ?? null,
        locationAccuracyM: input.location?.accuracy ?? null,
        startedAt: new Date(capturedAt),
        followUpOf,
      };
      audit = 'inspection.started';
    }

    const id = input.mode === 'start' && input.id ? input.id : generateId();
    try {
      await withRecordNumber(INSPECTION_NUMBER_INDEX, async () => {
        const number = await this.ctx.numbers.peek(project.id, 'inspection');
        const row: InspectionRow = {
          id,
          companyId: tenant.id,
          projectId: project.id,
          number,
          templateId: template.id,
          templateVersionId: version.id,
          status: 'draft',
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          inspectorId: principal.userId,
          plannedBy: null,
          plannedOn: null,
          note: null,
          areaId: null,
          locationId: null,
          workZoneId: null,
          inspectedOn: null,
          weather: null,
          notes: null,
          latitude: null,
          longitude: null,
          locationAccuracyM: null,
          startedAt: null,
          submittedAt: null,
          submitCount: 0,
          reviewStartedAt: null,
          reviewStartedBy: null,
          approvedAt: null,
          approvedBy: null,
          approvedOnSubmit: false,
          closedAt: null,
          scorePercent: null,
          scoreOutcome: null,
          followUpOf: null,
          offline: offline !== null,
          deviceId: offline?.deviceId ?? null,
          capturedAt: offline ? new Date(capturedAt) : null,
          receivedAt: new Date(offline?.receivedAt ?? now),
          version: 1,
          createdAt: new Date(now),
          createdBy: principal.userId,
          updatedAt: new Date(now),
          updatedBy: principal.userId,
          ...values,
        };
        const statements: Statement[] = [
          this.ctx.numbers.claim(project.id, 'inspection', number),
          this.ctx.db.insert(inspection).values(row),
          ...this.ctx.record(principal.userId, row, project, template, {
            audit,
            activity: audit,
            newValue: {
              reference: inspectionReference(project.code, number),
              templateId: template.id,
              versionNo: version.versionNo,
              inspectorId: row.inspectorId,
              plannedOn: row.plannedOn,
              ...offlineAudit(offline),
            },
          }),
        ];
        if (row.status === 'draft') {
          statements.push(
            ...(await this.ctx.notify('inspection.assigned', row, project, template, principal.userId, [
              row.inspectorId,
            ])),
          );
        }
        if (claim) {
          statements.push(
            this.ctx.keys.record(claim, {
              companyId: tenant.id,
              userId: principal.userId,
              resourceType: 'inspection',
              resourceId: id,
              statusCode: 201,
            }),
          );
        }
        await new UnitOfWork(this.ctx.db).add(...statements).commit();
      });
    } catch (error) {
      if (isUnique(error, 'inspection.id')) throw new RecordIdTakenError();
      throw error;
    }
    return { dto: await this.detail(tenant, project, principal, id), replayed: false };
  }

  // ---- Header update (Draft fields; In Progress header, offline) -------------------------

  async update(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    input: UpdateInput,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<InspectionDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    const { row } = loaded;
    if (row.cancelledAt !== null) throw new InspectionLockedError();
    if (row.status === 'draft') {
      if (!loaded.viewer.granted.has('projects.inspections.manage')) throw new ForbiddenError();
      return this.updateDraft(tenant, loaded, principal, input);
    }
    this.assertCapturing(loaded);
    const { baseVersion, ...values } = input;
    if (baseVersion !== undefined && baseVersion !== row.version) {
      throw await this.headerConflict(loaded, principal, baseVersion, values, offline);
    }
    const prepared = await this.prepareHeader(tenant, loaded, principal, values, row.version, claim, offline);
    try {
      await new UnitOfWork(this.ctx.db).add(...prepared.statements).commit();
    } catch (error) {
      if (!isVersionGuardFailure(error)) throw error;
      const latest = await this.load(tenant, project, principal, id);
      throw await this.headerConflict(latest, principal, baseVersion ?? row.version, values, offline);
    }
    return this.detail(tenant, project, principal, id);
  }

  private async updateDraft(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    input: UpdateInput,
  ): Promise<InspectionDto> {
    const { row, project } = loaded;
    const today = this.ctx.today(tenant);
    const next: Partial<InspectionRow> = {};
    if (input.templateId && input.templateId !== row.templateId) {
      const template = await this.activeTemplate(tenant.id, input.templateId);
      if (template.status === 'retired') throw new TemplateRetiredError();
      next.templateId = template.id;
      next.templateVersionId = template.currentVersionId ?? row.templateVersionId;
    }
    if (input.plannedOn !== undefined) {
      if (input.plannedOn < today || input.plannedOn > addIsoDays(today, INSPECTION_LIMITS.planDaysMax)) {
        throw new ValidationError([{ path: 'plannedOn', message: 'invalidDate' }]);
      }
      next.plannedOn = input.plannedOn;
    }
    if (input.note !== undefined) next.note = input.note;
    if (input.place !== undefined) {
      Object.assign(
        next,
        await this.placeFields(tenant, project.id, input.place, false, [
          row.areaId,
          row.locationId,
          row.workZoneId,
        ].filter((v): v is string => v !== null)),
      );
    }
    const now = new Date(this.ctx.now());
    const after: InspectionRow = { ...row, ...next, version: row.version + 1, updatedAt: now, updatedBy: principal.userId };
    const changed = Object.keys(next);
    await this.commitGuarded(row, [
      this.ctx.db
        .update(inspection)
        .set({ ...next, version: row.version + 1, updatedAt: now, updatedBy: principal.userId })
        .where(and(eq(inspection.id, row.id), eq(inspection.version, row.version), eq(inspection.status, 'draft'))),
      this.guard(row.id, row.version + 1),
      ...this.ctx.record(principal.userId, after, project, loaded.template, {
        audit: 'inspection.updated',
        activity: 'inspection.updated',
        oldValue: Object.fromEntries(changed.map((k) => [k, row[k as keyof InspectionRow]])),
        newValue: next,
        changes: {
          before: Object.fromEntries(changed.map((k) => [k, row[k as keyof InspectionRow]])),
          after: next,
        },
      }),
    ]);
    return this.detail(tenant, project, principal, row.id);
  }

  /** The header change as statements, guarded on `expectVersion` (also used by conflict resolution). */
  async prepareHeader(
    tenant: Pick<TenantCompany, 'id' | 'timeZone'>,
    loaded: Loaded,
    principal: Principal,
    values: Omit<UpdateInput, 'baseVersion'>,
    expectVersion: number,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<PreparedUpdate> {
    const { row, project } = loaded;
    const next: Partial<InspectionRow> = {};
    const today = this.ctx.today(tenant);
    if (values.place !== undefined || values.placeId !== undefined) {
      let selection = values.place;
      if (values.placeId !== undefined) {
        const resolved = values.placeId
          ? await this.ctx.places.resolve(tenant.id, project.id, values.placeId)
          : undefined;
        if (values.placeId && !resolved) throw new ValidationError([{ path: 'placeId', message: 'placeInvalid' }]);
        selection = resolved
          ? { areaId: resolved.areaId, locationId: resolved.locationId, workZoneId: resolved.workZoneId }
          : null;
      }
      Object.assign(
        next,
        await this.placeFields(
          tenant as TenantCompany,
          project.id,
          selection,
          loaded.version.content.areaRequired,
          [row.areaId, row.locationId, row.workZoneId].filter((v): v is string => v !== null),
        ),
      );
    }
    if (values.inspectedOn !== undefined) {
      if (values.inspectedOn > addIsoDays(today, 1)) {
        throw new ValidationError([{ path: 'inspectedOn', message: 'future' }]);
      }
      next.inspectedOn = values.inspectedOn;
    }
    if (values.weather !== undefined) next.weather = values.weather;
    if (values.notes !== undefined) next.notes = values.notes;
    if (values.location !== undefined) {
      next.latitude = values.location?.latitude ?? null;
      next.longitude = values.location?.longitude ?? null;
      next.locationAccuracyM = values.location?.accuracy ?? null;
    }
    const now = new Date(this.ctx.now());
    const version = expectVersion + 1;
    const changed = Object.keys(next);
    const after: InspectionRow = { ...row, ...next, version, updatedAt: now, updatedBy: principal.userId };
    const statements: Statement[] = [
      this.ctx.db
        .update(inspection)
        .set({ ...next, version, updatedAt: now, updatedBy: principal.userId })
        .where(
          and(eq(inspection.id, row.id), eq(inspection.version, expectVersion), eq(inspection.status, 'in_progress')),
        ),
      this.guard(row.id, version),
      ...this.ctx.record(principal.userId, after, project, loaded.template, {
        audit: 'inspection.updated',
        activity: 'inspection.updated',
        oldValue: Object.fromEntries(changed.map((k) => [k, row[k as keyof InspectionRow]])),
        newValue: { ...next, ...offlineAudit(offline) },
        changes: {
          before: Object.fromEntries(changed.map((k) => [k, row[k as keyof InspectionRow]])),
          after: next,
        },
      }),
    ];
    if (claim) {
      statements.push(
        this.ctx.keys.record(claim, {
          companyId: row.companyId,
          userId: principal.userId,
          resourceType: 'inspection',
          resourceId: row.id,
          statusCode: 200,
        }),
      );
    }
    return { statements, record: { id: row.id, version, ...this.headerValues(after) } };
  }

  headerValues(row: InspectionRow): Record<string, unknown> {
    return {
      placeId: placeOf(row),
      inspectedOn: row.inspectedOn,
      weather: row.weather,
      notes: row.notes,
    };
  }

  headerSnapshot(row: InspectionRow, projectCode: string): SyncSnapshot {
    return {
      version: row.version,
      values: this.headerValues(row),
      projectId: row.projectId,
      projectCode,
      label: `Inspection ${inspectionReference(projectCode, row.number)}`,
      changedBy: row.updatedBy,
    };
  }

  private async headerConflict(
    loaded: Loaded,
    principal: Principal,
    baseVersion: number,
    values: Record<string, unknown>,
    offline: OfflineMeta | null,
  ): Promise<SyncConflictError> {
    if (!offline) return new SyncConflictError(null, loaded.row.version);
    return new SyncConflictService(this.ctx.db, this.ctx.deps.meta, this.ctx.deps.clock).detect({
      companyId: loaded.row.companyId,
      userId: principal.userId,
      entity: inspectionSyncEntity,
      entityId: loaded.row.id,
      baseVersion,
      clientPayload: { ...values },
      snapshot: this.headerSnapshot(loaded.row, loaded.project.code),
    });
  }

  private guard(id: string, version: number): Statement {
    return this.ctx.db
      .select({
        ok: sql<number>`case when ${inspection.version} = ${version} then 1 else json('inspection changed') end`,
      })
      .from(inspection)
      .where(eq(inspection.id, id));
  }

  private async commitGuarded(row: InspectionRow, statements: Statement[]): Promise<void> {
    try {
      await new UnitOfWork(this.ctx.db).add(...statements).commit();
    } catch (error) {
      const text = String((error as { message?: unknown } | null)?.message ?? error);
      if (!text.includes(GUARD)) throw error;
      const current = await this.ctx.db
        .select({ status: inspection.status })
        .from(inspection)
        .where(eq(inspection.id, row.id))
        .get();
      throw new InspectionTransitionError(current?.status ?? row.status);
    }
  }

  // ---- Item results (US-034) -------------------------------------------------------------

  async saveItem(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    itemKey: string,
    input: ItemInput,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<InspectionItemDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertCapturing(loaded);
    if (!allItems(loaded.version.content).some((item) => item.key === itemKey)) throw new ItemUnknownError();
    const existing = await this.ctx.db
      .select()
      .from(inspectionItemResult)
      .where(and(eq(inspectionItemResult.inspectionId, id), eq(inspectionItemResult.itemKey, itemKey)))
      .get();
    const { baseVersion, ...values } = input;
    if (existing && baseVersion !== undefined && baseVersion !== existing.version) {
      throw await this.itemConflict(loaded, principal, existing, baseVersion, values, offline);
    }
    const prepared = await this.prepareItem(loaded, principal, itemKey, existing ?? null, values, claim, offline);
    try {
      await new UnitOfWork(this.ctx.db).add(...prepared.statements).commit();
    } catch (error) {
      if (!isVersionGuardFailure(error) && !isUnique(error, 'inspection_item_result')) throw error;
      const latest = await this.ctx.db
        .select()
        .from(inspectionItemResult)
        .where(and(eq(inspectionItemResult.inspectionId, id), eq(inspectionItemResult.itemKey, itemKey)))
        .get();
      if (!latest) throw error;
      throw await this.itemConflict(loaded, principal, latest, baseVersion ?? latest.version - 1, values, offline);
    }
    const saved = await this.ctx.db
      .select()
      .from(inspectionItemResult)
      .where(and(eq(inspectionItemResult.inspectionId, id), eq(inspectionItemResult.itemKey, itemKey)))
      .get();
    if (!saved) throw new NotFoundError();
    const people = await this.people([saved.assignedTo]);
    return {
      itemKey,
      result: saved.result,
      comment: saved.comment,
      priority: saved.priority,
      assignedTo: saved.assignedTo ? (people.get(saved.assignedTo) ?? null) : null,
      raiseFinding: saved.raiseFinding,
      version: saved.version,
    };
  }

  /** The item change as statements; an existing row is guarded on its version. */
  async prepareItem(
    loaded: Loaded,
    principal: Principal,
    itemKey: string,
    existing: InspectionItemResultRow | null,
    values: Omit<ItemInput, 'baseVersion'>,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
    expectVersion?: number,
  ): Promise<PreparedUpdate> {
    const { row, project, version } = loaded;
    if (values.result !== undefined && values.result !== null && !version.content.results.includes(values.result)) {
      throw new ValidationError([{ path: 'result', message: 'notAllowed' }]);
    }
    if (values.assignedTo) {
      const access = await this.ctx.withAccess(row.companyId, row.projectId, [values.assignedTo]);
      if (access.length === 0) throw new ValidationError([{ path: 'assignedTo', message: 'noAccess' }]);
    }
    const now = new Date(this.ctx.now());
    const merged = {
      result: values.result !== undefined ? values.result : (existing?.result ?? null),
      comment: values.comment !== undefined ? values.comment : (existing?.comment ?? null),
      priority: values.priority !== undefined ? values.priority : (existing?.priority ?? null),
      assignedTo: values.assignedTo !== undefined ? values.assignedTo : (existing?.assignedTo ?? null),
      raiseFinding: values.raiseFinding ?? existing?.raiseFinding ?? false,
    };
    if (merged.result !== 'fail' && merged.result !== 'observation') merged.priority = null;
    if (merged.result !== 'observation') merged.raiseFinding = false;
    const statements: Statement[] = [];
    let nextVersion = 1;
    if (existing) {
      const expect = expectVersion ?? existing.version;
      nextVersion = expect + 1;
      statements.push(
        this.ctx.db
          .update(inspectionItemResult)
          .set({ ...merged, version: nextVersion, capturedAt: offline ? new Date(offline.capturedAt) : now, updatedAt: now, updatedBy: principal.userId })
          .where(and(eq(inspectionItemResult.id, existing.id), eq(inspectionItemResult.version, expect))),
        this.ctx.db
          .select({
            ok: sql<number>`case when ${inspectionItemResult.version} = ${nextVersion} then 1 else json('item changed') end`,
          })
          .from(inspectionItemResult)
          .where(eq(inspectionItemResult.id, existing.id)),
      );
    } else {
      statements.push(
        this.ctx.db.insert(inspectionItemResult).values({
          id: generateId(),
          companyId: row.companyId,
          inspectionId: row.id,
          itemKey,
          ...merged,
          capturedAt: offline ? new Date(offline.capturedAt) : now,
          version: 1,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
      );
    }
    // Every change also moves the inspection's `updated_at` (lists) but not its version.
    statements.push(
      this.ctx.db
        .update(inspection)
        .set({ updatedAt: now, updatedBy: principal.userId })
        .where(and(eq(inspection.id, row.id), eq(inspection.status, 'in_progress'))),
      this.ctx.audit.entry({
        action: 'inspection.items_saved',
        actorUserId: principal.userId,
        companyId: row.companyId,
        projectId: row.projectId,
        entityType: 'inspection',
        entityId: row.id,
        oldValue: existing ? { [itemKey]: existing.result } : null,
        newValue: { [itemKey]: merged.result, ...offlineAudit(offline) },
      }),
    );
    if (claim) {
      statements.push(
        this.ctx.keys.record(claim, {
          companyId: row.companyId,
          userId: principal.userId,
          resourceType: 'inspection_item',
          resourceId: `${row.id}:${itemKey}`,
          statusCode: 200,
        }),
      );
    }
    void project;
    return { statements, record: { id: `${row.id}:${itemKey}`, version: nextVersion, ...merged } };
  }

  itemSnapshot(item: InspectionItemResultRow, loaded: Pick<Loaded, 'row' | 'project' | 'version'>): SyncSnapshot {
    const question = allItems(loaded.version.content).find((i) => i.key === item.itemKey)?.question;
    return {
      version: item.version,
      values: {
        result: item.result,
        comment: item.comment,
        priority: item.priority,
        assignedTo: item.assignedTo,
        raiseFinding: item.raiseFinding,
      },
      projectId: loaded.row.projectId,
      projectCode: loaded.project.code,
      label: `Inspection ${inspectionReference(loaded.project.code, loaded.row.number)} · ${localized(question, 'en')}`.slice(0, 200),
      changedBy: item.updatedBy,
    };
  }

  private async itemConflict(
    loaded: Loaded,
    principal: Principal,
    item: InspectionItemResultRow,
    baseVersion: number,
    values: Record<string, unknown>,
    offline: OfflineMeta | null,
  ): Promise<SyncConflictError> {
    if (!offline) return new SyncConflictError(null, item.version);
    return new SyncConflictService(this.ctx.db, this.ctx.deps.meta, this.ctx.deps.clock).detect({
      companyId: loaded.row.companyId,
      userId: principal.userId,
      entity: inspectionItemSyncEntity,
      entityId: `${loaded.row.id}:${item.itemKey}`,
      baseVersion,
      clientPayload: { ...values },
      snapshot: this.itemSnapshot(item, loaded),
    });
  }

  // ---- Files (US-035) --------------------------------------------------------------------

  async addFile(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    file: File,
    itemKey: string | null,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<InspectionFileDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertCapturing(loaded);
    if (itemKey && !allItems(loaded.version.content).some((item) => item.key === itemKey)) {
      throw new ItemUnknownError();
    }
    const files = await this.fileRows(id);
    if (files.length >= INSPECTION_LIMITS.filesMax) {
      throw new InspectionFileLimitError('total', INSPECTION_LIMITS.filesMax);
    }
    if (itemKey) {
      if (files.filter((f) => f.itemKey === itemKey).length >= INSPECTION_LIMITS.photosPerItem) {
        throw new InspectionFileLimitError('item', INSPECTION_LIMITS.photosPerItem);
      }
      if (!(INSPECTION_FILE_RULES.photoTypes as readonly string[]).includes(file.type) && file.type !== '') {
        // Item evidence is photos (the type is checked again by content in the file service).
        if (file.type === 'application/pdf') {
          throw new ValidationError([{ path: 'file', message: 'photoOnly' }]);
        }
      }
    } else if (files.filter((f) => f.itemKey === null).length >= INSPECTION_LIMITS.headerFilesMax) {
      throw new InspectionFileLimitError('header', INSPECTION_LIMITS.headerFilesMax);
    }
    const stored = await this.ctx.files.store({
      companyId: tenant.id,
      category: 'inspection_evidence',
      uploadedBy: principal.userId,
      file,
      beforeWrite: this.ctx.storageCheck(tenant.id),
    });
    const now = new Date(this.ctx.now());
    const linkId = generateId();
    const statements: Statement[] = [
      stored.statement,
      this.ctx.db.insert(inspectionFile).values({
        id: linkId,
        companyId: tenant.id,
        inspectionId: id,
        itemKey,
        fileId: stored.row.id,
        capturedAt: new Date(offline?.capturedAt ?? now.getTime()),
        submittedWith: null,
        removedAt: null,
        removedBy: null,
        createdAt: now,
        createdBy: principal.userId,
      }),
      ...this.ctx.record(principal.userId, loaded.row, loaded.project, loaded.template, {
        audit: 'inspection.file_added',
        activity: 'inspection.file_added',
        newValue: {
          itemKey,
          size: stored.row.sizeBytes,
          type: stored.row.contentType,
          ...offlineAudit(offline),
        },
        snapshot: { fileName: stored.row.fileName },
      }),
    ];
    if (claim) {
      statements.push(
        this.ctx.keys.record(claim, {
          companyId: tenant.id,
          userId: principal.userId,
          resourceType: 'inspection_file',
          resourceId: linkId,
          statusCode: 201,
        }),
      );
    }
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    return this.fileDto(tenant, project, principal, id, linkId);
  }

  async fileDto(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    linkId: string,
  ): Promise<InspectionFileDto> {
    const loaded = await this.load(tenant, project, principal, id);
    const files = await this.fileRows(id);
    const dtos = await this.fileDtos(files, loaded.row, loaded.row.submitCount);
    const found = dtos.find((f) => f.id === linkId);
    if (!found) throw new NotFoundError();
    return found;
  }

  async removeFile(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    linkId: string,
  ): Promise<void> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertCapturing(loaded);
    const link = (await this.fileRows(id)).find((f) => f.id === linkId);
    if (!link) throw new NotFoundError();
    if (link.submittedWith !== null || link.createdBy !== principal.userId) throw new InspectionLockedError();
    const now = new Date(this.ctx.now());
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(inspectionFile)
          .set({ removedAt: now, removedBy: principal.userId })
          .where(and(eq(inspectionFile.id, linkId), isNull(inspectionFile.submittedWith))),
        ...this.ctx.record(principal.userId, loaded.row, loaded.project, loaded.template, {
          audit: 'inspection.file_removed',
          activity: 'inspection.file_removed',
          oldValue: { fileId: link.fileId, itemKey: link.itemKey },
        }),
      )
      .commit();
  }

  async openFile(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    linkId: string,
  ): Promise<OpenedFile | null> {
    await this.load(tenant, project, principal, id);
    const link = await this.ctx.db
      .select()
      .from(inspectionFile)
      .where(and(eq(inspectionFile.inspectionId, id), eq(inspectionFile.id, linkId)))
      .get();
    if (!link) return null;
    return this.ctx.files.open(link.fileId, tenant.id);
  }

  // ---- Readiness (US-036) ----------------------------------------------------------------

  private async capture(loaded: Loaded) {
    const [itemRows, files] = await Promise.all([this.items(loaded.row.id), this.fileRows(loaded.row.id)]);
    const photoCount = (key: string) => files.filter((f) => f.itemKey === key).length;
    const items = itemRows.map((item) => ({
      itemKey: item.itemKey,
      result: item.result,
      comment: item.comment,
      photoCount: photoCount(item.itemKey),
    }));
    return { itemRows, files, items };
  }

  async readiness(tenant: TenantCompany, project: ProjectArg, principal: Principal, id: string): Promise<ReadinessDto> {
    const loaded = await this.load(tenant, project, principal, id);
    const { items, itemRows } = await this.capture(loaded);
    const content = loaded.version.content;
    return {
      issues: inspectionReadiness(content, items, loaded.row.areaId !== null),
      score: scoreInspection(content, items),
      findingCount: itemRows.filter(
        (i) => i.result === 'fail' || (i.result === 'observation' && i.raiseFinding),
      ).length,
    };
  }

  // ---- Workflow (T-78) -------------------------------------------------------------------

  async transition(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    input: TransitionInput,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<InspectionDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    const { row } = loaded;
    if (row.cancelledAt !== null) throw new InspectionLockedError();
    const facts = this.facts(loaded.viewer, row);
    const step = inspectionStep(input.to);
    if (!step.from.includes(row.status)) {
      if (row.status === 'approved' || row.status === 'closed') throw new InspectionLockedError();
      throw new InspectionTransitionError(row.status);
    }
    if (offline && !step.offline) throw new InspectionTransitionError(row.status);
    switch (step.actor) {
      case 'inspector':
        if (row.inspectorId !== principal.userId) throw new NotInspectorError();
        if (!facts.inspector) throw new ForbiddenError();
        if (input.to === 'withdraw' && facts.reviewStarted) throw new InspectionTransitionError(row.status);
        break;
      case 'manager':
        if (!facts.manage) throw new ForbiddenError();
        break;
      case 'approver':
        if (row.inspectorId === principal.userId) throw new SelfApprovalError();
        if (!facts.approve) throw new ForbiddenError();
        break;
      case 'inspector_or_manager':
        if (!facts.manage && !(row.inspectorId === principal.userId && facts.unplanned)) {
          throw new ForbiddenError();
        }
        break;
    }
    const workflow = new InspectionWorkflow(this);
    await withActionNumber(async () => {
      const statements = await workflow.statements(tenant, loaded, principal, input, offline);
      if (claim) {
        statements.push(
          this.ctx.keys.record(claim, {
            companyId: row.companyId,
            userId: principal.userId,
            resourceType: 'inspection',
            resourceId: row.id,
            statusCode: 200,
          }),
        );
      }
      await this.commitGuarded(row, statements);
    });
    return this.detail(tenant, project, principal, id);
  }

  /** US-037 FR-1: the first eligible reviewer to open it marks it Under review. */
  async reviewStart(tenant: TenantCompany, project: ProjectArg, principal: Principal, id: string): Promise<void> {
    const loaded = await this.load(tenant, project, principal, id);
    const { row } = loaded;
    if (row.inspectorId === principal.userId) throw new SelfApprovalError();
    if (!loaded.viewer.granted.has('projects.inspections.approve')) throw new ForbiddenError();
    if (row.status !== 'submitted' || row.reviewStartedAt !== null || loaded.viewer.archived) return;
    const now = new Date(this.ctx.now());
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(inspection)
          .set({ reviewStartedAt: now, reviewStartedBy: principal.userId })
          .where(and(eq(inspection.id, row.id), eq(inspection.status, 'submitted'), isNull(inspection.reviewStartedAt))),
        this.ctx.audit.entry({
          action: 'inspection.review_started',
          actorUserId: principal.userId,
          companyId: row.companyId,
          projectId: row.projectId,
          entityType: 'inspection',
          entityId: row.id,
        }),
      )
      .commit();
  }

  // ---- Findings (US-037, US-039) ---------------------------------------------------------

  private async loadFinding(loaded: Loaded, findingId: string): Promise<InspectionFindingRow> {
    const finding = await this.ctx.db
      .select()
      .from(inspectionFinding)
      .where(and(eq(inspectionFinding.inspectionId, loaded.row.id), eq(inspectionFinding.id, findingId)))
      .get();
    if (!finding) throw new NotFoundError();
    return finding;
  }

  async updateFinding(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    findingId: string,
    input: UpdateFindingRequest,
  ): Promise<FindingDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    const { row, viewer } = loaded;
    if (row.status !== 'submitted') throw new InspectionLockedError();
    if (row.inspectorId === principal.userId) throw new SelfApprovalError();
    if (!viewer.granted.has('projects.inspections.approve') && !viewer.granted.has('projects.inspections.manage')) {
      throw new ForbiddenError();
    }
    const finding = await this.loadFinding(loaded, findingId);
    const next: Partial<InspectionFindingRow> = {};
    if (input.description !== undefined) next.description = input.description;
    if (input.severity !== undefined) next.severity = input.severity;
    if (input.responsibleId !== undefined) {
      if (input.responsibleId) {
        const access = await this.ctx.withAccess(row.companyId, row.projectId, [input.responsibleId]);
        if (access.length === 0) throw new ValidationError([{ path: 'responsibleId', message: 'noAccess' }]);
      }
      next.responsibleId = input.responsibleId;
    }
    if (input.dueOn !== undefined) {
      const today = this.ctx.today(tenant);
      if (input.dueOn < today || input.dueOn > addIsoDays(today, 366)) {
        throw new ValidationError([{ path: 'dueOn', message: 'invalidDate' }]);
      }
      next.dueOn = input.dueOn;
    }
    if (input.decision !== undefined) {
      next.decision = input.decision;
      if (input.decision === 'no_action') {
        const reason = input.reason ?? finding.noActionReason;
        if (!reason || reason.length < INSPECTION_LIMITS.reasonMin) {
          throw new ValidationError([{ path: 'reason', message: 'required' }]);
        }
        next.noActionReason = reason;
      } else {
        next.noActionReason = null;
      }
    }
    const now = new Date(this.ctx.now());
    const changed = Object.keys(next);
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(inspectionFinding)
          .set({ ...next, editedAt: now, editedBy: principal.userId, updatedAt: now, updatedBy: principal.userId })
          .where(eq(inspectionFinding.id, finding.id)),
        ...this.ctx.record(principal.userId, row, loaded.project, loaded.template, {
          audit: 'inspection.finding_updated',
          activity: 'inspection.finding_updated',
          oldValue: Object.fromEntries(changed.map((k) => [k, finding[k as keyof InspectionFindingRow]])),
          newValue: next,
          snapshot: { findingSeq: finding.seq },
        }),
      )
      .commit();
    const updated = await this.loadFinding(loaded, findingId);
    const [dto] = await this.findingDtos(row.companyId, project.code, [updated], await this.fileRows(row.id));
    if (!dto) throw new NotFoundError();
    return dto;
  }

  async raiseAction(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    findingId: string,
    input: RaiseFindingActionRequest,
  ): Promise<{ actionId: string; reference: string }> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    const { row, viewer } = loaded;
    if (row.status !== 'approved') throw new InspectionTransitionError(row.status);
    if (!viewer.granted.has('projects.actions.create') && !viewer.granted.has('projects.inspections.approve')) {
      throw new ForbiddenError();
    }
    const finding = await this.loadFinding(loaded, findingId);
    if (finding.status === 'resolved' || finding.status === 'no_action') throw new FindingLockedError();
    const engine = this.actionEngine();
    const prepared = await withActionNumber(async () => {
      const result = await engine.prepare({
        tenant,
        project: { id: project.id, code: project.code, status: project.status as ProjectRow['status'] },
        source: { module: 'inspection', recordId: finding.id },
        type: 'corrective',
        priority: input.priority ?? finding.severity,
        title: (input.title ?? this.actionTitle(loaded.version.content, finding)).slice(0, 150),
        description: input.description ?? finding.description,
        ownerId: input.ownerId,
        dueOn: input.dueOn,
        place: { areaId: row.areaId, locationId: row.locationId, workZoneId: row.workZoneId },
        createdBy: principal.userId,
      });
      const now = new Date(this.ctx.now());
      await new UnitOfWork(this.ctx.db)
        .add(
          ...result.statements,
          this.ctx.db
            .update(inspectionFinding)
            .set({ status: 'action_raised', updatedAt: now, updatedBy: principal.userId })
            .where(eq(inspectionFinding.id, finding.id)),
          ...this.ctx.record(principal.userId, row, loaded.project, loaded.template, {
            audit: 'inspection.finding_action_raised',
            activity: 'inspection.finding_action_raised',
            newValue: { findingId: finding.id, action: result.reference },
            snapshot: { findingSeq: finding.seq, actionReference: result.reference },
          }),
        )
        .commit();
      return result;
    });
    return { actionId: prepared.row.id, reference: prepared.reference };
  }

  async noAction(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    findingId: string,
    reason: string,
  ): Promise<FindingDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    const { row, viewer } = loaded;
    if (row.status !== 'approved') throw new InspectionTransitionError(row.status);
    if (!viewer.granted.has('projects.inspections.manage')) throw new ForbiddenError();
    const finding = await this.loadFinding(loaded, findingId);
    if (finding.status !== 'open') throw new FindingLockedError();
    const now = new Date(this.ctx.now());
    const closing = await new InspectionWorkflow(this).closeIfResolved(
      row,
      loaded.project,
      loaded.template,
      [{ ...finding, status: 'no_action' }],
      principal.userId,
      now.getTime() + 1,
    );
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(inspectionFinding)
          .set({ status: 'no_action', noActionReason: reason, decision: 'no_action', updatedAt: now, updatedBy: principal.userId })
          .where(and(eq(inspectionFinding.id, finding.id), eq(inspectionFinding.status, 'open'))),
        ...this.ctx.record(principal.userId, row, loaded.project, loaded.template, {
          audit: 'inspection.finding_no_action',
          activity: 'inspection.finding_no_action',
          newValue: { findingId: finding.id, reason },
          snapshot: { findingSeq: finding.seq, reason: reason.slice(0, 200) },
        }),
        ...closing,
      )
      .commit();
    const updated = await this.loadFinding(loaded, findingId);
    const [dto] = await this.findingDtos(row.companyId, project.code, [updated], await this.fileRows(row.id));
    if (!dto) throw new NotFoundError();
    return dto;
  }

  actionEngine(): ActionEngine {
    if (!this.ctx.deps.bucket) throw new Error('Actions need the full request context');
    return new ActionEngine(
      new ActionContext({
        db: this.ctx.db,
        meta: this.ctx.deps.meta,
        clock: this.ctx.deps.clock,
        bucket: this.ctx.deps.bucket,
        resolver: this.ctx.resolver,
      }),
    );
  }

  actionTitle(content: TemplateContent, finding: Pick<InspectionFindingRow, 'itemKey' | 'description'>): string {
    const item = allItems(content).find((i) => i.key === finding.itemKey);
    const title = localized(item?.question, 'en') || finding.description;
    return title.length >= 5 ? title : `${title} (inspection finding)`;
  }

  async projectFindings(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    query: FindingListQuery,
  ): Promise<FindingPageDto> {
    const viewer = await this.viewer(tenant, project, principal);
    const today = this.ctx.today(tenant);
    const conditions: (SQL | undefined)[] = [
      eq(inspectionFinding.companyId, tenant.id),
      eq(inspectionFinding.projectId, project.id),
      inArray(inspection.status, ['approved', 'closed']),
      this.visibilityCondition(viewer),
    ];
    if (query.status === 'open') conditions.push(inArray(inspectionFinding.status, ['open', 'action_raised']));
    if (query.severity) conditions.push(eq(inspectionFinding.severity, query.severity));
    if (query.overdue) conditions.push(lt(inspectionFinding.dueOn, today));
    if (query.place) {
      conditions.push(
        or(eq(inspection.areaId, query.place), eq(inspection.locationId, query.place), eq(inspection.workZoneId, query.place)),
      );
    }
    const where = and(...conditions);
    const rows = await this.ctx.db
      .select({ finding: inspectionFinding, parent: inspection })
      .from(inspectionFinding)
      .innerJoin(inspection, eq(inspection.id, inspectionFinding.inspectionId))
      .where(where)
      .orderBy(
        sql`case ${inspectionFinding.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
        asc(inspectionFinding.dueOn),
      )
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = await this.ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(inspectionFinding)
      .innerJoin(inspection, eq(inspection.id, inspectionFinding.inspectionId))
      .where(where)
      .get();
    const dtos = await this.findingDtos(tenant.id, project.code, rows.map((r) => r.finding), []);
    const places = await this.placeNames(tenant.id, project.id, rows.map((r) => r.parent));
    return {
      items: dtos.map((dto, index) => {
        const parent = rows[index]?.parent;
        const placeId = parent ? placeOf(parent) : null;
        return {
          ...dto,
          inspectionId: parent?.id ?? '',
          inspectionReference: parent ? inspectionReference(project.code, parent.number) : null,
          placeName: placeId ? (places.get(placeId) ?? null) : null,
        };
      }),
      total: total?.n ?? 0,
    };
  }

  // ---- History and comments ---------------------------------------------------------------

  async history(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    before: string | undefined,
  ): Promise<TimelinePageDto> {
    const { row } = await this.load(tenant, project, principal, id);
    const { rows, next } = await this.ctx.activity.listForEntity(
      tenant.id,
      { type: 'inspection', id: row.id },
      { before: parseActivityCursor(before), limit: 50 },
    );
    const actors = await userSummaries(
      this.ctx.db,
      rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])),
    );
    return {
      nextBefore: next,
      items: rows.map((entry): ActivityEntryDto => {
        const actor = entry.actorUserId ? actors.get(entry.actorUserId) : undefined;
        const name = entry.action as ActivityEntryDto['action'];
        return {
          id: entry.id,
          action: name,
          group: ACTIVITY_ACTIONS[name],
          actorName: actor?.fullName ?? null,
          actorFormer: actor ? actor.former || actor.companyId !== tenant.id : false,
          occurredAt: entry.occurredAt.getTime(),
          changes: entry.changes ? (JSON.parse(entry.changes) as ActivityEntryDto['changes']) : null,
          snapshot: entry.snapshot ? (JSON.parse(entry.snapshot) as ActivityEntryDto['snapshot']) : {},
        };
      }),
    };
  }

  private commentTarget(loaded: Loaded): CommentTarget {
    const { row } = loaded;
    return {
      companyId: row.companyId,
      projectId: row.projectId,
      entityType: 'inspection',
      entityId: row.id,
      locked: row.status === 'closed' || row.cancelledAt !== null || loaded.viewer.archived,
    };
  }

  async comments(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    before: string | undefined,
  ): Promise<CommentPageDto> {
    const loaded = await this.load(tenant, project, principal, id);
    const target = this.commentTarget(loaded);
    const { rows, nextBefore } = await this.ctx.comments.list(target, parseCommentCursor(before));
    const authors = [...new Set(rows.map((r) => r.authorId))];
    const names = await userSummaries(this.ctx.db, authors);
    const access = new Set(await this.ctx.withAccess(tenant.id, project.id, authors));
    return {
      comments: rows.map(
        (r): CommentDto => ({
          id: r.id,
          author: {
            id: r.authorId,
            name: names.get(r.authorId)?.fullName ?? '',
            stillHasAccess: access.has(r.authorId),
          },
          body: r.body,
          createdAt: r.createdAt.getTime(),
          editedAt: r.editedAt?.getTime() ?? null,
          canEdit: !target.locked && this.ctx.comments.editable(r, principal.userId),
        }),
      ),
      nextBefore,
      locked: target.locked,
    };
  }

  async addComment(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    body: string,
  ): Promise<CommentDto> {
    const loaded = await this.load(tenant, project, principal, id);
    if (loaded.viewer.archived) throw new ProjectArchivedError();
    if ((await this.ctx.comments.recentCount(principal.userId)) >= COMMENT_LIMITS.postsPerMinute) {
      throw new RateLimitedError();
    }
    const target = this.commentTarget(loaded);
    const { row: posted, statements } = this.ctx.comments.add(target, principal.userId, body);
    const { row } = loaded;
    const previous = await this.ctx.comments.list(target, null);
    const recipients = await this.ctx.withAccess(tenant.id, project.id, [
      row.inspectorId,
      ...(row.approvedBy ? [row.approvedBy] : []),
      ...(row.reviewStartedBy ? [row.reviewStartedBy] : []),
      ...previous.rows.map((r) => r.authorId),
    ]);
    statements.push(
      ...(await this.ctx.notifications.groupedEntries(
        {
          type: 'inspection.comment_added',
          companyId: tenant.id,
          projectId: project.id,
          entityType: 'inspection',
          entityId: row.id,
          actorUserId: principal.userId,
          params: this.ctx.params(row, loaded.project, loaded.template),
          recipients,
        },
        COMMENT_LIMITS.groupWindowMs,
      )),
    );
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    const names = await userSummaries(this.ctx.db, [principal.userId]);
    return {
      id: posted.id,
      author: { id: principal.userId, name: names.get(principal.userId)?.fullName ?? '', stillHasAccess: true },
      body: posted.body,
      createdAt: posted.createdAt.getTime(),
      editedAt: null,
      canEdit: true,
    };
  }

  async editComment(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    commentId: string,
    body: string,
  ): Promise<CommentDto> {
    const loaded = await this.load(tenant, project, principal, id);
    if (loaded.viewer.archived) throw new ProjectArchivedError();
    const target = this.commentTarget(loaded);
    const existing = await this.ctx.comments.find(target, commentId);
    if (!existing) throw new NotFoundError();
    const { row: edited, statements } = this.ctx.comments.edit(target, existing, principal.userId, body);
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    const names = await userSummaries(this.ctx.db, [principal.userId]);
    return {
      id: edited.id,
      author: { id: principal.userId, name: names.get(principal.userId)?.fullName ?? '', stillHasAccess: true },
      body: edited.body,
      createdAt: edited.createdAt.getTime(),
      editedAt: edited.editedAt?.getTime() ?? null,
      canEdit: this.ctx.comments.editable(edited, principal.userId),
    };
  }

  /** PlaceUsage (T-39): inspections using a place, cancelled included. */
  async countUsingPlace(placeId: string): Promise<number> {
    const row = await this.ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(inspection)
      .where(or(eq(inspection.areaId, placeId), eq(inspection.locationId, placeId), eq(inspection.workZoneId, placeId)))
      .get();
    return row?.n ?? 0;
  }
}


export type { CreateInspectionRequest, InspectionStatus, InspectionTransitionRequest, ItemResultRequest, UpdateInspectionRequest };
