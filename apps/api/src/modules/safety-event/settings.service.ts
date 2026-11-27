import {
  type EventTypeRequest,
  eventTypeRequestSchema,
  generateId,
  SAFETY_EVENT_LIMITS,
  SAFETY_LISTS,
  type SafetyEventTypeDto,
  type SafetyList,
  type SafetyListItemDto,
  type SafetyListItemRequest,
  type SafetySettingsDto,
  type SafetySettingsPackDto,
  SEED_EVENT_TYPES,
  SEED_SAFETY_LISTS,
} from "@hse/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Principal } from "../../core/auth/principal";
import type { TenantCompany } from "../../core/context/tenant";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../core/errors/app-error";
import type { RequestMeta } from "../../core/http/request-meta";
import type { Database } from "../../database/client";
import { type Statement, UnitOfWork } from "../../database/unit-of-work";
import { type AuditAction, AuditLogService } from "../../platform/audit-log";
import type { PermissionResolver } from "../identity";
import {
  FamilyLockedError,
  SafetyListNameTakenError,
} from "./safety-event.errors";
import {
  safetyEvent,
  safetyEventCategoryLink,
  safetyEventCause,
  safetyEventType,
  type SafetyEventTypeRow,
  safetyListItem,
  type SafetyListItemRow,
} from "./safety-event.schema";

export interface SettingsDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  resolver: PermissionResolver;
}

const MANAGE = "safety_events.settings.manage";

function nameKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

interface Named {
  id: string;
  nameKeyEn: string | null;
  nameKeyAr: string | null;
}

function assertUnique(
  rows: readonly Named[],
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
  if (clash) throw new SafetyListNameTakenError();
}

/** PLT-33 (O-164, O-165, O-171): event types and the three company lists, seeded on first use. */
export class SafetySettingsService {
  private readonly audit: AuditLogService;

  constructor(private readonly deps: SettingsDeps) {
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
  }

  private get db(): Database {
    return this.deps.db;
  }

  private now(): Date {
    return new Date(this.deps.clock());
  }

  async canManage(
    tenant: Pick<TenantCompany, "id">,
    principal: Principal,
  ): Promise<boolean> {
    return (
      await this.deps.resolver.companyPermissions(principal.userId, tenant.id)
    ).has(MANAGE);
  }

  /** Readers: managers and whoever can report or view safety events on any project. */
  async assertReader(
    tenant: TenantCompany,
    principal: Principal,
  ): Promise<void> {
    if (await this.canManage(tenant, principal)) return;
    for (const code of [
      "projects.safety_events.report",
      "projects.safety_events.view",
    ]) {
      const access = await this.deps.resolver.projectAccess(
        principal.userId,
        tenant.id,
        code,
      );
      if (access.allProjects || access.projectIds.length > 0) return;
    }
    throw new ForbiddenError();
  }

  private async assertManager(
    tenant: TenantCompany,
    principal: Principal,
  ): Promise<void> {
    if (!(await this.canManage(tenant, principal))) throw new ForbiddenError();
  }

  private auditEntry(
    principal: Principal,
    tenant: TenantCompany,
    action: AuditAction,
    entity: { type: string; id: string },
    values: {
      oldValue?: Record<string, unknown>;
      newValue?: Record<string, unknown>;
    } = {},
  ): Statement {
    return this.audit.entry({
      action,
      actorUserId: principal.userId,
      companyId: tenant.id,
      entityType: entity.type,
      entityId: entity.id,
      oldValue: values.oldValue ?? null,
      newValue: values.newValue ?? null,
    });
  }

  // ---- Seed ----------------------------------------------------------------------------

  /** Seeds the ten types and the three lists on first use; safe on every read. */
  async ensureSeeded(companyId: string): Promise<void> {
    const existing = await this.db
      .select({ id: safetyEventType.id })
      .from(safetyEventType)
      .where(eq(safetyEventType.companyId, companyId))
      .limit(1)
      .get();
    if (existing) return;
    const now = this.now();
    const statements: Statement[] = SEED_EVENT_TYPES.map((type, index) =>
      this.db
        .insert(safetyEventType)
        .values({
          id: generateId(),
          companyId,
          nameEn: type.en,
          nameAr: type.ar,
          nameKeyEn: nameKey(type.en),
          nameKeyAr: nameKey(type.ar),
          family: type.family,
          investigation: type.investigation,
          minSeverity: type.minSeverity,
          injuryDetails: type.injuryDetails,
          areaRequired: false,
          riskRating: type.riskRating,
          position: index + 1,
          active: true,
          deactivatedAt: null,
          seedKey: type.key,
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          updatedBy: null,
        })
        .onConflictDoNothing(),
    );
    for (const list of SAFETY_LISTS) {
      SEED_SAFETY_LISTS[list].forEach((item, index) => {
        statements.push(
          this.db
            .insert(safetyListItem)
            .values({
              id: generateId(),
              companyId,
              list,
              nameEn: item.en,
              nameAr: item.ar,
              nameKeyEn: nameKey(item.en),
              nameKeyAr: nameKey(item.ar),
              position: index + 1,
              active: true,
              seedKey: item.key,
              createdAt: now,
              createdBy: null,
              updatedAt: now,
              updatedBy: null,
            })
            .onConflictDoNothing(),
        );
      });
    }
    try {
      await new UnitOfWork(this.db).add(...statements).commit();
    } catch (error) {
      const text = String(
        (error as { message?: unknown } | null)?.message ?? error,
      );
      if (!text.includes("UNIQUE")) throw error;
    }
  }

  // ---- Reading ---------------------------------------------------------------------------

  typeRows(companyId: string): Promise<SafetyEventTypeRow[]> {
    return this.db
      .select()
      .from(safetyEventType)
      .where(eq(safetyEventType.companyId, companyId))
      .orderBy(asc(safetyEventType.position))
      .all();
  }

  listRows(companyId: string, list?: SafetyList): Promise<SafetyListItemRow[]> {
    return this.db
      .select()
      .from(safetyListItem)
      .where(
        and(
          eq(safetyListItem.companyId, companyId),
          list ? eq(safetyListItem.list, list) : undefined,
        ),
      )
      .orderBy(asc(safetyListItem.position))
      .all();
  }

  async findType(
    companyId: string,
    id: string,
  ): Promise<SafetyEventTypeRow | undefined> {
    return this.db
      .select()
      .from(safetyEventType)
      .where(
        and(
          eq(safetyEventType.companyId, companyId),
          eq(safetyEventType.id, id),
        ),
      )
      .get();
  }

  private async typesInUse(companyId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ typeId: safetyEvent.typeId })
      .from(safetyEvent)
      .where(eq(safetyEvent.companyId, companyId))
      .groupBy(safetyEvent.typeId)
      .all();
    return new Set(rows.map((r) => r.typeId));
  }

  private async itemsInUse(companyId: string): Promise<Set<string>> {
    const [links, causes] = await Promise.all([
      this.db
        .select({ id: safetyEventCategoryLink.categoryId })
        .from(safetyEventCategoryLink)
        .where(eq(safetyEventCategoryLink.companyId, companyId))
        .groupBy(safetyEventCategoryLink.categoryId)
        .all(),
      this.db
        .select({ id: safetyEventCause.categoryId })
        .from(safetyEventCause)
        .where(
          and(
            eq(safetyEventCause.companyId, companyId),
            sql`${safetyEventCause.categoryId} is not null`,
          ),
        )
        .groupBy(safetyEventCause.categoryId)
        .all(),
    ]);
    return new Set([...links, ...causes].flatMap((r) => (r.id ? [r.id] : [])));
  }

  typeDto(row: SafetyEventTypeRow, inUse: boolean): SafetyEventTypeDto {
    return {
      id: row.id,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      family: row.family,
      investigation: row.investigation,
      minSeverity: row.minSeverity,
      injuryDetails: row.injuryDetails,
      areaRequired: row.areaRequired,
      riskRating: row.riskRating,
      active: row.active,
      position: row.position,
      inUse,
    };
  }

  itemDto(row: SafetyListItemRow, inUse: boolean): SafetyListItemDto {
    return {
      id: row.id,
      list: row.list,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      active: row.active,
      position: row.position,
      inUse,
    };
  }

  async settings(
    tenant: TenantCompany,
    principal: Principal,
  ): Promise<SafetySettingsDto> {
    await this.assertReader(tenant, principal);
    await this.ensureSeeded(tenant.id);
    const [types, items, typesUsed, itemsUsed] = await Promise.all([
      this.typeRows(tenant.id),
      this.listRows(tenant.id),
      this.typesInUse(tenant.id),
      this.itemsInUse(tenant.id),
    ]);
    const lists = Object.fromEntries(
      SAFETY_LISTS.map((list) => [list, [] as SafetyListItemDto[]]),
    ) as Record<SafetyList, SafetyListItemDto[]>;
    for (const item of items)
      lists[item.list].push(this.itemDto(item, itemsUsed.has(item.id)));
    return {
      types: types.map((t) => this.typeDto(t, typesUsed.has(t.id))),
      lists,
      canManage: await this.canManage(tenant, principal),
    };
  }

  /** T-90: active types and categories for the report screen (also offline). */
  async pack(
    tenant: TenantCompany,
    principal: Principal,
  ): Promise<SafetySettingsPackDto> {
    await this.assertReader(tenant, principal);
    await this.ensureSeeded(tenant.id);
    const [types, categories] = await Promise.all([
      this.typeRows(tenant.id),
      this.listRows(tenant.id, "category"),
    ]);
    return {
      types: types.filter((t) => t.active).map((t) => this.typeDto(t, false)),
      categories: categories
        .filter((c) => c.active)
        .map((c) => this.itemDto(c, false)),
      generatedAt: this.deps.clock(),
    };
  }

  // ---- Types -----------------------------------------------------------------------------

  private names(input: { nameEn?: string | null; nameAr?: string | null }): {
    en: string | null;
    ar: string | null;
  } {
    const en = clean(input.nameEn);
    const ar = clean(input.nameAr);
    if (!en && !ar)
      throw new ValidationError([{ path: "nameEn", message: "required" }]);
    return { en, ar };
  }

  async createType(
    tenant: TenantCompany,
    principal: Principal,
    input: EventTypeRequest,
  ): Promise<SafetyEventTypeDto> {
    await this.assertManager(tenant, principal);
    await this.ensureSeeded(tenant.id);
    const parsed: z.output<typeof eventTypeRequestSchema> =
      eventTypeRequestSchema.parse(input);
    const names = this.names(parsed);
    const rows = await this.typeRows(tenant.id);
    if (rows.length >= SAFETY_EVENT_LIMITS.typesMax) {
      throw new ValidationError([{ path: "nameEn", message: "limitReached" }]);
    }
    assertUnique(rows, names);
    const now = this.now();
    const id = generateId();
    await new UnitOfWork(this.db)
      .add(
        this.db.insert(safetyEventType).values({
          id,
          companyId: tenant.id,
          nameEn: names.en,
          nameAr: names.ar,
          nameKeyEn: nameKey(names.en),
          nameKeyAr: nameKey(names.ar),
          family: parsed.family,
          investigation: parsed.investigation,
          minSeverity: parsed.minSeverity,
          injuryDetails: parsed.family === "incident" && parsed.injuryDetails,
          areaRequired: parsed.areaRequired,
          riskRating: parsed.riskRating,
          position: (rows.at(-1)?.position ?? 0) + 1,
          active: true,
          deactivatedAt: null,
          seedKey: null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        this.auditEntry(
          principal,
          tenant,
          "safety_event_type.created",
          { type: "safety_event_type", id },
          {
            newValue: {
              ...names,
              family: parsed.family,
              investigation: parsed.investigation,
            },
          },
        ),
      )
      .commit();
    return this.typeDto(
      (await this.findType(tenant.id, id)) as SafetyEventTypeRow,
      false,
    );
  }

  async updateType(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    input: EventTypeRequest,
  ): Promise<SafetyEventTypeDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findType(tenant.id, id);
    if (!row) throw new NotFoundError();
    const parsed: z.output<typeof eventTypeRequestSchema> =
      eventTypeRequestSchema.parse(input);
    const names = this.names(parsed);
    assertUnique(await this.typeRows(tenant.id), names, id);
    const used = (await this.typesInUse(tenant.id)).has(id);
    if (used && parsed.family !== row.family) throw new FamilyLockedError();
    const next = {
      nameEn: names.en,
      nameAr: names.ar,
      nameKeyEn: nameKey(names.en),
      nameKeyAr: nameKey(names.ar),
      family: parsed.family,
      investigation: parsed.investigation,
      minSeverity: parsed.minSeverity,
      injuryDetails: parsed.family === "incident" && parsed.injuryDetails,
      areaRequired: parsed.areaRequired,
      riskRating: parsed.riskRating,
    };
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(safetyEventType)
          .set({ ...next, updatedAt: this.now(), updatedBy: principal.userId })
          .where(eq(safetyEventType.id, id)),
        this.auditEntry(
          principal,
          tenant,
          "safety_event_type.updated",
          { type: "safety_event_type", id },
          {
            oldValue: {
              en: row.nameEn,
              ar: row.nameAr,
              investigation: row.investigation,
              minSeverity: row.minSeverity,
              riskRating: row.riskRating,
            },
            newValue: {
              ...names,
              investigation: next.investigation,
              minSeverity: next.minSeverity,
              riskRating: next.riskRating,
            },
          },
        ),
      )
      .commit();
    return this.typeDto({ ...row, ...next }, used);
  }

  async moveType(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    direction: "up" | "down",
  ): Promise<void> {
    await this.assertManager(tenant, principal);
    const rows = await this.typeRows(tenant.id);
    await this.swap(
      tenant,
      principal,
      rows,
      id,
      direction,
      (rowId, position) =>
        this.db
          .update(safetyEventType)
          .set({ position, updatedAt: this.now(), updatedBy: principal.userId })
          .where(eq(safetyEventType.id, rowId)),
      "safety_event_type.moved",
      "safety_event_type",
    );
  }

  async setTypeActive(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    active: boolean,
  ): Promise<SafetyEventTypeDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findType(tenant.id, id);
    if (!row) throw new NotFoundError();
    const now = this.now();
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(safetyEventType)
          .set({
            active,
            deactivatedAt: active ? null : now,
            updatedAt: now,
            updatedBy: principal.userId,
          })
          .where(eq(safetyEventType.id, id)),
        this.auditEntry(
          principal,
          tenant,
          active
            ? "safety_event_type.reactivated"
            : "safety_event_type.deactivated",
          { type: "safety_event_type", id },
        ),
      )
      .commit();
    return this.typeDto(
      { ...row, active, deactivatedAt: active ? null : now },
      (await this.typesInUse(tenant.id)).has(id),
    );
  }

  // ---- Lists -----------------------------------------------------------------------------

  private async findItem(
    companyId: string,
    id: string,
  ): Promise<SafetyListItemRow> {
    const row = await this.db
      .select()
      .from(safetyListItem)
      .where(
        and(eq(safetyListItem.companyId, companyId), eq(safetyListItem.id, id)),
      )
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  async createItem(
    tenant: TenantCompany,
    principal: Principal,
    list: SafetyList,
    input: SafetyListItemRequest,
  ): Promise<SafetyListItemDto> {
    await this.assertManager(tenant, principal);
    await this.ensureSeeded(tenant.id);
    const names = this.names(input);
    const rows = await this.listRows(tenant.id, list);
    if (rows.length >= SAFETY_EVENT_LIMITS.listItemsMax) {
      throw new ValidationError([{ path: "nameEn", message: "limitReached" }]);
    }
    assertUnique(rows, names);
    const now = this.now();
    const id = generateId();
    await new UnitOfWork(this.db)
      .add(
        this.db.insert(safetyListItem).values({
          id,
          companyId: tenant.id,
          list,
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
        this.auditEntry(
          principal,
          tenant,
          "safety_list_item.created",
          { type: "safety_list_item", id },
          {
            newValue: { list, ...names },
          },
        ),
      )
      .commit();
    return this.itemDto(await this.findItem(tenant.id, id), false);
  }

  async updateItem(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    input: SafetyListItemRequest,
  ): Promise<SafetyListItemDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findItem(tenant.id, id);
    const names = this.names(input);
    assertUnique(await this.listRows(tenant.id, row.list), names, id);
    const next = {
      nameEn: names.en,
      nameAr: names.ar,
      nameKeyEn: nameKey(names.en),
      nameKeyAr: nameKey(names.ar),
    };
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(safetyListItem)
          .set({ ...next, updatedAt: this.now(), updatedBy: principal.userId })
          .where(eq(safetyListItem.id, id)),
        this.auditEntry(
          principal,
          tenant,
          "safety_list_item.updated",
          { type: "safety_list_item", id },
          {
            oldValue: { en: row.nameEn, ar: row.nameAr },
            newValue: names,
          },
        ),
      )
      .commit();
    return this.itemDto(
      { ...row, ...next },
      (await this.itemsInUse(tenant.id)).has(id),
    );
  }

  async moveItem(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    direction: "up" | "down",
  ): Promise<void> {
    await this.assertManager(tenant, principal);
    const row = await this.findItem(tenant.id, id);
    const rows = await this.listRows(tenant.id, row.list);
    await this.swap(
      tenant,
      principal,
      rows,
      id,
      direction,
      (rowId, position) =>
        this.db
          .update(safetyListItem)
          .set({ position, updatedAt: this.now(), updatedBy: principal.userId })
          .where(eq(safetyListItem.id, rowId)),
      "safety_list_item.moved",
      "safety_list_item",
    );
  }

  async setItemActive(
    tenant: TenantCompany,
    principal: Principal,
    id: string,
    active: boolean,
  ): Promise<SafetyListItemDto> {
    await this.assertManager(tenant, principal);
    const row = await this.findItem(tenant.id, id);
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(safetyListItem)
          .set({ active, updatedAt: this.now(), updatedBy: principal.userId })
          .where(eq(safetyListItem.id, id)),
        this.auditEntry(
          principal,
          tenant,
          active
            ? "safety_list_item.reactivated"
            : "safety_list_item.deactivated",
          { type: "safety_list_item", id },
        ),
      )
      .commit();
    return this.itemDto(
      { ...row, active },
      (await this.itemsInUse(tenant.id)).has(id),
    );
  }

  private async swap(
    tenant: TenantCompany,
    principal: Principal,
    rows: readonly { id: string; position: number }[],
    id: string,
    direction: "up" | "down",
    update: (id: string, position: number) => Statement,
    action: AuditAction,
    entityType: string,
  ): Promise<void> {
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new NotFoundError();
    const current = rows[index];
    const other = rows[direction === "up" ? index - 1 : index + 1];
    if (!current || !other) return;
    await new UnitOfWork(this.db)
      .add(
        update(current.id, other.position),
        update(other.id, current.position),
        this.auditEntry(
          principal,
          tenant,
          action,
          { type: entityType, id },
          { newValue: { direction } },
        ),
      )
      .commit();
  }
}
