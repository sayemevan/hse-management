import {
  type CategoryRequest,
  countItems,
  generateId,
  INSPECTION_LIMITS,
  type InspectionCategoryDto,
  type PersonRefDto,
  type SaveDraftRequest,
  saveDraftRequestSchema,
  type TemplateContent,
  templateChanges,
  type TemplateDetailDto,
  type TemplatePackDto,
  type TemplateSummaryDto,
  type TemplateVersionDto,
  type TemplateVersionListItemDto,
  validateTemplateForPublish,
} from '@hse/shared';
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/app-error';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { type AuditAction, AuditLogService } from '../../platform/audit-log';
import { type PermissionResolver, userSummaries } from '../identity';
import {
  CategoryNameTakenError,
  TemplateDraftChangedError,
  TemplateDraftExistsError,
  TemplateInUseError,
  TemplateInvalidError,
  TemplateLimitError,
  TemplateNameTakenError,
} from './inspection.errors';
import {
  inspection,
  inspectionCategory,
  type InspectionCategoryRow,
  inspectionTemplate,
  type InspectionTemplateRow,
  inspectionTemplateVersion,
  type InspectionTemplateVersionRow,
} from './inspection.schema';
import { SEED_CATEGORIES, STARTER_TEMPLATE, starterContent } from './inspection-seed';

export interface TemplateDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  resolver: PermissionResolver;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MANAGE = 'inspections.templates.manage';

function nameKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/\s+/g, ' ');
  return trimmed ? trimmed : null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** US-031, US-032: categories, templates and their versions (company level, T-75, T-76). */
export class TemplateService {
  private readonly audit: AuditLogService;

  constructor(private readonly deps: TemplateDeps) {
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
  }

  private get db(): Database {
    return this.deps.db;
  }

  private now(): Date {
    return new Date(this.deps.clock());
  }

  // ---- Access --------------------------------------------------------------------------

  async canManage(tenant: TenantCompany, principal: Principal): Promise<boolean> {
    return (await this.deps.resolver.companyPermissions(principal.userId, tenant.id)).has(MANAGE);
  }

  /** Readers of published templates: managers and whoever conducts or views inspections anywhere. */
  async assertReader(tenant: TenantCompany, principal: Principal): Promise<void> {
    if (await this.canManage(tenant, principal)) return;
    for (const code of ['projects.inspections.conduct', 'projects.inspections.view']) {
      const access = await this.deps.resolver.projectAccess(principal.userId, tenant.id, code);
      if (access.allProjects || access.projectIds.length > 0) return;
    }
    throw new ForbiddenError();
  }

  private async assertManager(tenant: TenantCompany, principal: Principal): Promise<void> {
    if (!(await this.canManage(tenant, principal))) throw new ForbiddenError();
  }

  private auditEntry(
    principal: Principal | null,
    tenant: TenantCompany,
    action: AuditAction,
    entity: { type: string; id: string },
    values: { oldValue?: Record<string, unknown>; newValue?: Record<string, unknown> } = {},
  ): Statement {
    return this.audit.entry({
      action,
      actorUserId: principal?.userId ?? null,
      companyId: tenant.id,
      entityType: entity.type,
      entityId: entity.id,
      oldValue: values.oldValue ?? null,
      newValue: values.newValue ?? null,
    });
  }

  // ---- Seed (O-141, O-142) -------------------------------------------------------------

  /** Seeds the categories and the starter template on first use; safe to call on every read. */
  async ensureSeeded(tenant: TenantCompany): Promise<void> {
    const existing = await this.db
      .select({ id: inspectionCategory.id })
      .from(inspectionCategory)
      .where(eq(inspectionCategory.companyId, tenant.id))
      .limit(1)
      .get();
    if (existing) return;
    const now = this.now();
    const categoryIds = new Map<string, string>();
    const statements: Statement[] = SEED_CATEGORIES.map((category, index) => {
      const id = generateId();
      categoryIds.set(category.key, id);
      return this.db
        .insert(inspectionCategory)
        .values({
          id,
          companyId: tenant.id,
          nameEn: category.en,
          nameAr: category.ar,
          nameKeyEn: nameKey(category.en),
          nameKeyAr: nameKey(category.ar),
          position: index + 1,
          active: true,
          seedKey: category.key,
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        })
        .onConflictDoNothing();
    });
    const templateId = generateId();
    const versionId = generateId();
    const content = starterContent(generateId);
    statements.push(
      this.db
        .insert(inspectionTemplate)
        .values({
          id: templateId,
          companyId: tenant.id,
          categoryId: categoryIds.get(STARTER_TEMPLATE.categoryKey) ?? '',
          nameEn: STARTER_TEMPLATE.nameEn,
          nameAr: STARTER_TEMPLATE.nameAr,
          nameKeyEn: nameKey(STARTER_TEMPLATE.nameEn),
          nameKeyAr: nameKey(STARTER_TEMPLATE.nameAr),
          status: 'active',
          currentVersionId: versionId,
          retiredAt: null,
          retiredBy: null,
          seedKey: STARTER_TEMPLATE.key,
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        })
        .onConflictDoNothing(),
      this.db.insert(inspectionTemplateVersion).values({
        id: versionId,
        companyId: tenant.id,
        templateId,
        versionNo: 1,
        state: 'published',
        content,
        itemCount: countItems(content),
        publishedAt: now,
        publishedBy: null,
        supersededAt: null,
        createdAt: now,
        createdBy: null,
        updatedAt: now,
        updatedBy: null,
      }),
      this.auditEntry(null, tenant, 'inspection_template.seeded', {
        type: 'inspection_template',
        id: templateId,
      }),
    );
    try {
      await new UnitOfWork(this.db).add(...statements).commit();
    } catch (error) {
      // Two first requests at once: the other one seeded.
      const text = String((error as { message?: unknown } | null)?.message ?? error);
      if (!text.includes('UNIQUE')) throw error;
    }
  }

  // ---- Categories ----------------------------------------------------------------------

  private categoryRows(companyId: string): Promise<InspectionCategoryRow[]> {
    return this.db
      .select()
      .from(inspectionCategory)
      .where(eq(inspectionCategory.companyId, companyId))
      .orderBy(asc(inspectionCategory.position))
      .all();
  }

  async listCategories(tenant: TenantCompany, principal: Principal): Promise<InspectionCategoryDto[]> {
    await this.assertReader(tenant, principal);
    await this.ensureSeeded(tenant);
    const rows = await this.categoryRows(tenant.id);
    const counts = await this.db
      .select({ categoryId: inspectionTemplate.categoryId, n: sql<number>`count(*)` })
      .from(inspectionTemplate)
      .where(eq(inspectionTemplate.companyId, tenant.id))
      .groupBy(inspectionTemplate.categoryId)
      .all();
    const byId = new Map(counts.map((row) => [row.categoryId, row.n]));
    return rows.map((row) => ({
      id: row.id,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      position: row.position,
      active: row.active,
      templateCount: byId.get(row.id) ?? 0,
    }));
  }

  private validateCategory(input: CategoryRequest): { en: string | null; ar: string | null } {
    const en = clean(input.nameEn);
    const ar = clean(input.nameAr);
    const issues = [];
    if (!en && !ar) issues.push({ path: 'nameEn', message: 'required' });
    for (const [path, value] of [
      ['nameEn', en],
      ['nameAr', ar],
    ] as const) {
      if (value && value.length < INSPECTION_LIMITS.categoryNameMin) {
        issues.push({ path, message: 'tooShort' });
      }
    }
    if (issues.length > 0) throw new ValidationError(issues);
    return { en, ar };
  }

  private assertCategoryUnique(
    rows: readonly InspectionCategoryRow[],
    names: { en: string | null; ar: string | null },
    exceptId?: string,
  ): void {
    const en = nameKey(names.en);
    const ar = nameKey(names.ar);
    const clash = rows.some(
      (row) =>
        row.id !== exceptId &&
        ((en !== null && (row.nameKeyEn === en || row.nameKeyAr === en)) ||
          (ar !== null && (row.nameKeyAr === ar || row.nameKeyEn === ar))),
    );
    if (clash) throw new CategoryNameTakenError();
  }

  async createCategory(
    tenant: TenantCompany,
    principal: Principal,
    input: CategoryRequest,
  ): Promise<InspectionCategoryDto> {
    await this.assertManager(tenant, principal);
    await this.ensureSeeded(tenant);
    const names = this.validateCategory(input);
    const rows = await this.categoryRows(tenant.id);
    if (rows.length >= INSPECTION_LIMITS.categoriesMax) {
      throw new ValidationError([{ path: 'nameEn', message: 'limitReached' }]);
    }
    this.assertCategoryUnique(rows, names);
    const now = this.now();
    const id = generateId();
    await new UnitOfWork(this.db)
      .add(
        this.db.insert(inspectionCategory).values({
          id,
          companyId: tenant.id,
          nameEn: names.en,
          nameAr: names.ar,
          nameKeyEn: nameKey(names.en),
          nameKeyAr: nameKey(names.ar),
          position: (rows.at(-1)?.position ?? 0) + 1,
          active: true,
          seedKey: null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        this.auditEntry(principal, tenant, 'inspection_category.created', {
          type: 'inspection_category',
          id,
        }, { newValue: names }),
      )
      .commit();
    return this.categoryDto(tenant, principal, id);
  }

  private async categoryDto(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
  ): Promise<InspectionCategoryDto> {
    const found = (await this.listCategories(tenant, principal)).find((row) => row.id === id);
    if (!found) throw new NotFoundError();
    return found;
  }

  private async findCategory(companyId: string, id: string): Promise<InspectionCategoryRow> {
    const row = await this.db
      .select()
      .from(inspectionCategory)
      .where(and(eq(inspectionCategory.companyId, companyId), eq(inspectionCategory.id, id)))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  async updateCategory(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    input: CategoryRequest,
  ): Promise<InspectionCategoryDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findCategory(tenant.id, id);
    const names = this.validateCategory(input);
    this.assertCategoryUnique(await this.categoryRows(tenant.id), names, id);
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(inspectionCategory)
          .set({
            nameEn: names.en,
            nameAr: names.ar,
            nameKeyEn: nameKey(names.en),
            nameKeyAr: nameKey(names.ar),
            updatedAt: this.now(),
            updatedBy: principal.userId,
          })
          .where(eq(inspectionCategory.id, id)),
        this.auditEntry(principal, tenant, 'inspection_category.updated', {
          type: 'inspection_category',
          id,
        }, { oldValue: { en: row.nameEn, ar: row.nameAr }, newValue: names }),
      )
      .commit();
    return this.categoryDto(tenant, principal, id);
  }

  async moveCategory(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    direction: 'up' | 'down',
  ): Promise<InspectionCategoryDto[]> {
    await this.assertManager(tenant, principal);
    const rows = await this.categoryRows(tenant.id);
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new NotFoundError();
    const other = rows[direction === 'up' ? index - 1 : index + 1];
    const current = rows[index];
    if (other && current) {
      const now = this.now();
      await new UnitOfWork(this.db)
        .add(
          this.db
            .update(inspectionCategory)
            .set({ position: other.position, updatedAt: now, updatedBy: principal.userId })
            .where(eq(inspectionCategory.id, current.id)),
          this.db
            .update(inspectionCategory)
            .set({ position: current.position, updatedAt: now, updatedBy: principal.userId })
            .where(eq(inspectionCategory.id, other.id)),
          this.auditEntry(principal, tenant, 'inspection_category.moved', {
            type: 'inspection_category',
            id,
          }, { newValue: { direction } }),
        )
        .commit();
    }
    return this.listCategories(tenant, principal);
  }

  async setCategoryActive(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    active: boolean,
  ): Promise<InspectionCategoryDto> {
    await this.assertManager(tenant, principal);
    await this.findCategory(tenant.id, id);
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(inspectionCategory)
          .set({ active, updatedAt: this.now(), updatedBy: principal.userId })
          .where(eq(inspectionCategory.id, id)),
        this.auditEntry(
          principal,
          tenant,
          active ? 'inspection_category.reactivated' : 'inspection_category.deactivated',
          { type: 'inspection_category', id },
        ),
      )
      .commit();
    return this.categoryDto(tenant, principal, id);
  }

  // ---- Templates -----------------------------------------------------------------------

  private async findTemplate(companyId: string, id: string): Promise<InspectionTemplateRow> {
    const row = await this.db
      .select()
      .from(inspectionTemplate)
      .where(and(eq(inspectionTemplate.companyId, companyId), eq(inspectionTemplate.id, id)))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  private versionsOf(templateIds: readonly string[]): Promise<InspectionTemplateVersionRow[]> {
    if (templateIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(inspectionTemplateVersion)
      .where(inArray(inspectionTemplateVersion.templateId, [...templateIds]))
      .orderBy(desc(inspectionTemplateVersion.versionNo))
      .all();
  }

  private async assertNameFree(
    companyId: string,
    names: { en: string | null; ar: string | null },
    exceptId?: string,
  ): Promise<void> {
    const keys = [nameKey(names.en), nameKey(names.ar)].filter((k): k is string => k !== null);
    if (keys.length === 0) return;
    const rows = await this.db
      .select({ id: inspectionTemplate.id, en: inspectionTemplate.nameKeyEn, ar: inspectionTemplate.nameKeyAr })
      .from(inspectionTemplate)
      .where(and(eq(inspectionTemplate.companyId, companyId), eq(inspectionTemplate.status, 'active')))
      .all();
    const clash = rows.some(
      (row) =>
        row.id !== exceptId && keys.some((key) => key === row.en || key === row.ar),
    );
    if (clash) throw new TemplateNameTakenError();
  }

  private async activeCount(companyId: string): Promise<number> {
    const row = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(inspectionTemplate)
      .where(and(eq(inspectionTemplate.companyId, companyId), eq(inspectionTemplate.status, 'active')))
      .get();
    return row?.n ?? 0;
  }

  private async people(ids: readonly (string | null)[]): Promise<Map<string, PersonRefDto>> {
    const summaries = await userSummaries(
      this.db,
      ids.filter((id): id is string => id !== null),
    );
    return new Map([...summaries].map(([id, s]) => [id, { id, name: s.fullName }]));
  }

  private versionDto(
    row: InspectionTemplateVersionRow,
    people: ReadonlyMap<string, PersonRefDto>,
  ): TemplateVersionDto {
    return {
      id: row.id,
      versionNo: row.versionNo,
      state: row.state,
      content: row.content,
      itemCount: row.itemCount,
      publishedAt: row.publishedAt?.getTime() ?? null,
      publishedBy: row.publishedBy ? (people.get(row.publishedBy) ?? null) : null,
      supersededAt: row.supersededAt?.getTime() ?? null,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  private summaries(
    rows: readonly InspectionTemplateRow[],
    versions: readonly InspectionTemplateVersionRow[],
    categories: ReadonlyMap<string, InspectionCategoryRow>,
  ): TemplateSummaryDto[] {
    return rows.map((row) => {
      const current = versions.find((v) => v.id === row.currentVersionId);
      const category = categories.get(row.categoryId);
      return {
        id: row.id,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        category: {
          id: row.categoryId,
          nameEn: category?.nameEn ?? null,
          nameAr: category?.nameAr ?? null,
        },
        status: row.status,
        currentVersionId: row.currentVersionId,
        currentVersionNo: current?.versionNo ?? null,
        itemCount: current?.itemCount ?? 0,
        hasDraft: versions.some((v) => v.templateId === row.id && v.state === 'draft'),
        updatedAt: row.updatedAt.getTime(),
      };
    });
  }

  async list(
    tenant: TenantCompany,
    principal: Principal,
    query: { status?: 'active' | 'retired' | undefined; category?: string | undefined },
  ): Promise<{ items: TemplateSummaryDto[]; canManage: boolean }> {
    await this.assertReader(tenant, principal);
    await this.ensureSeeded(tenant);
    const canManage = await this.canManage(tenant, principal);
    const conditions = [eq(inspectionTemplate.companyId, tenant.id)];
    if (query.status) conditions.push(eq(inspectionTemplate.status, query.status));
    if (query.category) conditions.push(eq(inspectionTemplate.categoryId, query.category));
    // Readers who don't manage see only published, active templates.
    if (!canManage) {
      conditions.push(eq(inspectionTemplate.status, 'active'), isNotNull(inspectionTemplate.currentVersionId));
    }
    const rows = await this.db
      .select()
      .from(inspectionTemplate)
      .where(and(...conditions))
      .orderBy(asc(inspectionTemplate.nameKeyEn), asc(inspectionTemplate.nameKeyAr))
      .all();
    const versions = await this.versionsOf(rows.map((row) => row.id));
    const categories = new Map((await this.categoryRows(tenant.id)).map((c) => [c.id, c]));
    return { items: this.summaries(rows, versions, categories), canManage };
  }

  async detail(tenant: TenantCompany, principal: Principal, id: string): Promise<TemplateDetailDto> {
    await this.assertReader(tenant, principal);
    const canManage = await this.canManage(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    if (!canManage && (row.status !== 'active' || !row.currentVersionId)) throw new NotFoundError();
    const versions = await this.versionsOf([row.id]);
    const categories = new Map((await this.categoryRows(tenant.id)).map((c) => [c.id, c]));
    const [summary] = this.summaries([row], versions, categories);
    if (!summary) throw new NotFoundError();
    const current = versions.find((v) => v.id === row.currentVersionId) ?? null;
    const draft = canManage ? (versions.find((v) => v.state === 'draft') ?? null) : null;
    const people = await this.people([current?.publishedBy ?? null]);
    return {
      ...summary,
      current: current ? this.versionDto(current, people) : null,
      draft: draft ? this.versionDto(draft, people) : null,
      changes: draft ? templateChanges(current?.content ?? null, draft.content) : null,
      canManage,
    };
  }

  async create(
    tenant: TenantCompany,
    principal: Principal,
    input: { nameEn?: string | null | undefined; nameAr?: string | null | undefined; categoryId: string },
  ): Promise<TemplateDetailDto> {
    await this.assertManager(tenant, principal);
    await this.ensureSeeded(tenant);
    const category = await this.findCategory(tenant.id, input.categoryId);
    if (!category.active) throw new ValidationError([{ path: 'categoryId', message: 'inactive' }]);
    if ((await this.activeCount(tenant.id)) >= INSPECTION_LIMITS.activeTemplatesMax) {
      throw new TemplateLimitError(INSPECTION_LIMITS.activeTemplatesMax);
    }
    const names = { en: clean(input.nameEn), ar: clean(input.nameAr) };
    await this.assertNameFree(tenant.id, names);
    const now = this.now();
    const id = generateId();
    const content: TemplateContent = {
      description: null,
      results: ['pass', 'fail', 'not_applicable'],
      scoring: { method: 'none', passMark: null },
      needsApproval: true,
      areaRequired: false,
      sections: [],
    };
    await new UnitOfWork(this.db)
      .add(
        this.db.insert(inspectionTemplate).values({
          id,
          companyId: tenant.id,
          categoryId: category.id,
          nameEn: names.en,
          nameAr: names.ar,
          nameKeyEn: nameKey(names.en),
          nameKeyAr: nameKey(names.ar),
          status: 'active',
          currentVersionId: null,
          retiredAt: null,
          retiredBy: null,
          seedKey: null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        this.db.insert(inspectionTemplateVersion).values({
          id: generateId(),
          companyId: tenant.id,
          templateId: id,
          versionNo: 1,
          state: 'draft',
          content,
          itemCount: 0,
          publishedAt: null,
          publishedBy: null,
          supersededAt: null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        this.auditEntry(principal, tenant, 'inspection_template.created', {
          type: 'inspection_template',
          id,
        }, { newValue: { ...names, categoryId: category.id } }),
      )
      .commit();
    return this.detail(tenant, principal, id);
  }

  private async draftOf(templateId: string): Promise<InspectionTemplateVersionRow | undefined> {
    return this.db
      .select()
      .from(inspectionTemplateVersion)
      .where(
        and(
          eq(inspectionTemplateVersion.templateId, templateId),
          eq(inspectionTemplateVersion.state, 'draft'),
        ),
      )
      .get();
  }

  async saveDraft(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    input: z.output<typeof saveDraftRequestSchema>,
  ): Promise<TemplateDetailDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    const draft = await this.draftOf(row.id);
    if (!draft) throw new NotFoundError();
    if (draft.updatedAt.getTime() !== input.expectedUpdatedAt) throw new TemplateDraftChangedError();
    if (countItems(input.content) > INSPECTION_LIMITS.itemsMax) {
      throw new TemplateInvalidError([{ path: 'sections', message: 'tooManyItems' }]);
    }
    const names = {
      en: input.nameEn === undefined ? row.nameEn : clean(input.nameEn),
      ar: input.nameAr === undefined ? row.nameAr : clean(input.nameAr),
    };
    if (!names.en && !names.ar) throw new ValidationError([{ path: 'nameEn', message: 'required' }]);
    if (row.status === 'active') await this.assertNameFree(tenant.id, names, row.id);
    if (input.categoryId && input.categoryId !== row.categoryId) {
      const category = await this.findCategory(tenant.id, input.categoryId);
      if (!category.active) throw new ValidationError([{ path: 'categoryId', message: 'inactive' }]);
    }
    const now = this.now();
    // At most one audit entry per editor and 10 minutes (US-031 audit).
    const lastSave = draft.updatedBy === principal.userId ? draft.updatedAt.getTime() : 0;
    const statements: Statement[] = [
      this.db
        .update(inspectionTemplateVersion)
        .set({
          content: input.content,
          itemCount: countItems(input.content),
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(
          and(
            eq(inspectionTemplateVersion.id, draft.id),
            eq(inspectionTemplateVersion.updatedAt, draft.updatedAt),
          ),
        ),
      this.db
        .update(inspectionTemplate)
        .set({
          nameEn: names.en,
          nameAr: names.ar,
          nameKeyEn: nameKey(names.en),
          nameKeyAr: nameKey(names.ar),
          categoryId: input.categoryId ?? row.categoryId,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(eq(inspectionTemplate.id, row.id)),
    ];
    if (now.getTime() - lastSave > 10 * 60 * 1000) {
      statements.push(
        this.auditEntry(principal, tenant, 'inspection_template.draft_saved', {
          type: 'inspection_template',
          id: row.id,
        }, { newValue: { versionNo: draft.versionNo, itemCount: countItems(input.content) } }),
      );
    }
    await new UnitOfWork(this.db).add(...statements).commit();
    const saved = await this.draftOf(row.id);
    if (saved?.updatedAt.getTime() !== now.getTime()) throw new TemplateDraftChangedError();
    return this.detail(tenant, principal, id);
  }

  async publish(tenant: TenantCompany, principal: Principal, id: string): Promise<TemplateDetailDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    const draft = await this.draftOf(row.id);
    if (!draft) throw new NotFoundError();
    const parsed = saveDraftRequestSchema.shape.content.safeParse(draft.content);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }
    const issues = validateTemplateForPublish(parsed.data);
    if (issues.length > 0) throw new TemplateInvalidError(issues);
    const previous = row.currentVersionId
      ? await this.db
          .select()
          .from(inspectionTemplateVersion)
          .where(eq(inspectionTemplateVersion.id, row.currentVersionId))
          .get()
      : undefined;
    const now = this.now();
    const changes = templateChanges(previous?.content ?? null, draft.content);
    const statements: Statement[] = [
      this.db
        .update(inspectionTemplateVersion)
        .set({ state: 'published', publishedAt: now, publishedBy: principal.userId, updatedAt: now })
        .where(
          and(eq(inspectionTemplateVersion.id, draft.id), eq(inspectionTemplateVersion.state, 'draft')),
        ),
      this.db
        .update(inspectionTemplate)
        .set({ currentVersionId: draft.id, updatedAt: now, updatedBy: principal.userId })
        .where(eq(inspectionTemplate.id, row.id)),
      this.auditEntry(principal, tenant, 'inspection_template.published', {
        type: 'inspection_template',
        id: row.id,
      }, {
        newValue: {
          fromVersion: previous?.versionNo ?? null,
          toVersion: draft.versionNo,
          itemCount: draft.itemCount,
          added: changes.added.length,
          changed: changes.changed.length,
          removed: changes.removed.length,
        },
      }),
    ];
    if (previous) {
      statements.splice(
        1,
        0,
        this.db
          .update(inspectionTemplateVersion)
          .set({ state: 'superseded', supersededAt: now, updatedAt: now })
          .where(eq(inspectionTemplateVersion.id, previous.id)),
      );
    }
    await new UnitOfWork(this.db).add(...statements).commit();
    return this.detail(tenant, principal, id);
  }

  /** US-032: a new draft copied from the current version (keys kept). */
  async createDraft(tenant: TenantCompany, principal: Principal, id: string): Promise<TemplateDetailDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    if (await this.draftOf(row.id)) throw new TemplateDraftExistsError();
    const versions = await this.versionsOf([row.id]);
    const current = versions.find((v) => v.id === row.currentVersionId);
    if (!current) throw new NotFoundError();
    const now = this.now();
    try {
      await new UnitOfWork(this.db)
        .add(
          this.db.insert(inspectionTemplateVersion).values({
            id: generateId(),
            companyId: tenant.id,
            templateId: row.id,
            versionNo: (versions[0]?.versionNo ?? 0) + 1,
            state: 'draft',
            content: current.content,
            itemCount: current.itemCount,
            publishedAt: null,
            publishedBy: null,
            supersededAt: null,
            createdAt: now,
            createdBy: principal.userId,
            updatedAt: now,
            updatedBy: principal.userId,
          }),
          this.auditEntry(principal, tenant, 'inspection_template.draft_created', {
            type: 'inspection_template',
            id: row.id,
          }, { newValue: { fromVersion: current.versionNo } }),
        )
        .commit();
    } catch (error) {
      const text = String((error as { message?: unknown } | null)?.message ?? error);
      if (text.includes('UNIQUE')) throw new TemplateDraftExistsError();
      throw error;
    }
    return this.detail(tenant, principal, id);
  }

  async discardDraft(tenant: TenantCompany, principal: Principal, id: string): Promise<void> {
    await this.assertManager(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    const draft = await this.draftOf(row.id);
    if (!draft) throw new NotFoundError();
    if (!row.currentVersionId) {
      // Never published: discarding the only draft deletes the template.
      await this.remove(tenant, principal, id);
      return;
    }
    await new UnitOfWork(this.db)
      .add(
        this.db.delete(inspectionTemplateVersion).where(eq(inspectionTemplateVersion.id, draft.id)),
        this.auditEntry(principal, tenant, 'inspection_template.draft_discarded', {
          type: 'inspection_template',
          id: row.id,
        }, { oldValue: { versionNo: draft.versionNo } }),
      )
      .commit();
  }

  async remove(tenant: TenantCompany, principal: Principal, id: string): Promise<void> {
    await this.assertManager(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    const published = await this.db
      .select({ id: inspectionTemplateVersion.id })
      .from(inspectionTemplateVersion)
      .where(
        and(
          eq(inspectionTemplateVersion.templateId, row.id),
          ne(inspectionTemplateVersion.state, 'draft'),
        ),
      )
      .get();
    if (published || row.currentVersionId) throw new TemplateInUseError();
    await new UnitOfWork(this.db)
      .add(
        this.db.delete(inspectionTemplateVersion).where(eq(inspectionTemplateVersion.templateId, row.id)),
        this.db.delete(inspectionTemplate).where(eq(inspectionTemplate.id, row.id)),
        this.auditEntry(principal, tenant, 'inspection_template.deleted', {
          type: 'inspection_template',
          id: row.id,
        }, { oldValue: { nameEn: row.nameEn, nameAr: row.nameAr } }),
      )
      .commit();
  }

  async setRetired(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    retired: boolean,
  ): Promise<TemplateDetailDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    if (!retired) {
      if (row.status === 'active') return this.detail(tenant, principal, id);
      await this.assertNameFree(tenant.id, { en: row.nameEn, ar: row.nameAr }, row.id);
      const category = await this.findCategory(tenant.id, row.categoryId);
      if (!category.active) throw new ValidationError([{ path: 'categoryId', message: 'inactive' }]);
      if ((await this.activeCount(tenant.id)) >= INSPECTION_LIMITS.activeTemplatesMax) {
        throw new TemplateLimitError(INSPECTION_LIMITS.activeTemplatesMax);
      }
    } else if (row.status === 'retired') {
      return this.detail(tenant, principal, id);
    }
    const now = this.now();
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(inspectionTemplate)
          .set({
            status: retired ? 'retired' : 'active',
            retiredAt: retired ? now : null,
            retiredBy: retired ? principal.userId : null,
            updatedAt: now,
            updatedBy: principal.userId,
          })
          .where(eq(inspectionTemplate.id, row.id)),
        this.auditEntry(
          principal,
          tenant,
          retired ? 'inspection_template.retired' : 'inspection_template.reactivated',
          { type: 'inspection_template', id: row.id },
        ),
      )
      .commit();
    return this.detail(tenant, principal, id);
  }

  /** US-032: a new template whose draft copies the current version with fresh keys. */
  async duplicate(tenant: TenantCompany, principal: Principal, id: string): Promise<TemplateDetailDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    const versions = await this.versionsOf([row.id]);
    const source =
      versions.find((v) => v.id === row.currentVersionId) ?? versions.find((v) => v.state === 'draft');
    if (!source) throw new NotFoundError();
    if ((await this.activeCount(tenant.id)) >= INSPECTION_LIMITS.activeTemplatesMax) {
      throw new TemplateLimitError(INSPECTION_LIMITS.activeTemplatesMax);
    }
    const copyName = async (base: string | null, suffix: string) => {
      if (!base) return null;
      for (let n = 1; n < 50; n += 1) {
        const candidate = `${base} ${suffix}${n > 1 ? ` ${String(n)}` : ''}`.slice(
          0,
          INSPECTION_LIMITS.templateNameMax,
        );
        try {
          await this.assertNameFree(tenant.id, { en: candidate, ar: null });
          return candidate;
        } catch {
          // try the next number
        }
      }
      return `${base} ${generateId().slice(0, 4)}`;
    };
    const names = { en: await copyName(row.nameEn, '(copy)'), ar: await copyName(row.nameAr, '(نسخة)') };
    const content: TemplateContent = {
      ...source.content,
      sections: source.content.sections.map((section) => ({
        ...section,
        key: generateId(),
        items: section.items.map((item) => ({ ...item, key: generateId() })),
      })),
    };
    const now = this.now();
    const newId = generateId();
    await new UnitOfWork(this.db)
      .add(
        this.db.insert(inspectionTemplate).values({
          id: newId,
          companyId: tenant.id,
          categoryId: row.categoryId,
          nameEn: names.en,
          nameAr: names.ar,
          nameKeyEn: nameKey(names.en),
          nameKeyAr: nameKey(names.ar),
          status: 'active',
          currentVersionId: null,
          retiredAt: null,
          retiredBy: null,
          seedKey: null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        this.db.insert(inspectionTemplateVersion).values({
          id: generateId(),
          companyId: tenant.id,
          templateId: newId,
          versionNo: 1,
          state: 'draft',
          content,
          itemCount: countItems(content),
          publishedAt: null,
          publishedBy: null,
          supersededAt: null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        this.auditEntry(principal, tenant, 'inspection_template.duplicated', {
          type: 'inspection_template',
          id: newId,
        }, { newValue: { from: row.id } }),
      )
      .commit();
    return this.detail(tenant, principal, newId);
  }

  async versions(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
  ): Promise<TemplateVersionListItemDto[]> {
    await this.assertManager(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    const rows = (await this.versionsOf([row.id])).filter((v) => v.state !== 'draft');
    const counts = await this.db
      .select({ versionId: inspection.templateVersionId, n: sql<number>`count(*)` })
      .from(inspection)
      .where(and(eq(inspection.companyId, tenant.id), eq(inspection.templateId, row.id)))
      .groupBy(inspection.templateVersionId)
      .all();
    const byVersion = new Map(counts.map((c) => [c.versionId, c.n]));
    const people = await this.people(rows.map((v) => v.publishedBy));
    return rows.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      state: v.state === 'published' ? 'published' : 'superseded',
      publishedAt: v.publishedAt?.getTime() ?? null,
      publishedBy: v.publishedBy ? (people.get(v.publishedBy) ?? null) : null,
      inspectionCount: byVersion.get(v.id) ?? 0,
    }));
  }

  async version(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    versionNo: number,
  ): Promise<TemplateVersionDto> {
    await this.assertReader(tenant, principal);
    const row = await this.findTemplate(tenant.id, id);
    const found = (await this.versionsOf([row.id])).find(
      (v) => v.versionNo === versionNo && v.state !== 'draft',
    );
    if (!found) throw new NotFoundError();
    return this.versionDto(found, await this.people([found.publishedBy]));
  }

  // ---- Device pack (T-80) --------------------------------------------------------------

  /** Published versions of active templates, plus versions superseded in the grace window. */
  async pack(tenant: TenantCompany, principal: Principal): Promise<TemplatePackDto> {
    await this.assertReader(tenant, principal);
    await this.ensureSeeded(tenant);
    const now = this.deps.clock();
    const templates = await this.db
      .select()
      .from(inspectionTemplate)
      .where(and(eq(inspectionTemplate.companyId, tenant.id), eq(inspectionTemplate.status, 'active')))
      .all();
    const versions = await this.versionsOf(templates.map((t) => t.id));
    const categories = new Map((await this.categoryRows(tenant.id)).map((c) => [c.id, c]));
    const grace = INSPECTION_LIMITS.supersededGraceDays * DAY_MS;
    const items: TemplatePackDto['versions'] = [];
    for (const template of templates) {
      const category = categories.get(template.categoryId);
      for (const version of versions.filter((v) => v.templateId === template.id)) {
        const current = version.id === template.currentVersionId;
        const recent =
          version.state === 'superseded' &&
          version.supersededAt !== null &&
          now - version.supersededAt.getTime() <= grace;
        if (!current && !recent) continue;
        items.push({
          templateId: template.id,
          versionId: version.id,
          versionNo: version.versionNo,
          nameEn: template.nameEn,
          nameAr: template.nameAr,
          categoryNameEn: category?.nameEn ?? null,
          categoryNameAr: category?.nameAr ?? null,
          current,
          publishedAt: version.publishedAt?.getTime() ?? 0,
          supersededAt: version.supersededAt?.getTime() ?? null,
          content: version.content,
        });
      }
    }
    items.sort((a, b) => (a.nameEn ?? a.nameAr ?? '').localeCompare(b.nameEn ?? b.nameAr ?? ''));
    return { versions: items, generatedAt: now };
  }
}

export type { SaveDraftRequest };
