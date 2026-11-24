import {
  generateId,
  WORKFORCE_LIMITS,
  WORKFORCE_LIST_SEEDS,
  type WorkforceList,
  type WorkforceListItemDto,
  workforceKey,
} from '@hse/shared';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import type { Principal } from '../../core/auth/principal';
import { NotFoundError } from '../../core/errors/app-error';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import { UnitOfWork } from '../../database/unit-of-work';
import { type AuditAction, AuditLogService } from '../../platform/audit-log';
import {
  ListItemInactiveError,
  ListItemInUseError,
  ListItemNameTakenError,
  ListLimitReachedError,
} from './workforce.errors';
import {
  workforceAssignment,
  workforceListItem,
  type WorkforceListItemRow,
  workforceMember,
  workforceRecord,
} from './workforce.schema';

const SEED_NAMES = new Map(
  Object.values(WORKFORCE_LIST_SEEDS).flatMap((items) =>
    items.map((item) => [item.key, item.name] as const),
  ),
);

/**
 * A seeded item shows its translation until someone renames it (T-54). The seed key stays on
 * the row (so the company is never seeded twice); the item counts as renamed once its name
 * differs from the seed name.
 */
export function listItemRef(row: WorkforceListItemRow): {
  id: string;
  name: string;
  seedKey: string | null;
} {
  const seeded = row.seedKey && SEED_NAMES.get(row.seedKey) === row.name ? row.seedKey : null;
  return { id: row.id, name: row.name, seedKey: seeded };
}

export interface ListServiceDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
}

/** PLT-21: job positions and competencies of a company. */
export class WorkforceListService {
  private readonly audit: AuditLogService;

  constructor(private readonly deps: ListServiceDeps) {
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
  }

  private get db(): Database {
    return this.deps.db;
  }

  /** T-54: seeds both lists the first time a company uses them (refinement: on first use). */
  async ensureSeeded(companyId: string): Promise<void> {
    const seeded = await this.db
      .select({ list: workforceListItem.list })
      .from(workforceListItem)
      .where(and(eq(workforceListItem.companyId, companyId), isNotNull(workforceListItem.seedKey)))
      .groupBy(workforceListItem.list)
      .all();
    const done = new Set(seeded.map((row) => row.list));
    const now = new Date(this.deps.clock());
    for (const [list, items] of Object.entries(WORKFORCE_LIST_SEEDS) as [
      WorkforceList,
      (typeof WORKFORCE_LIST_SEEDS)[WorkforceList],
    ][]) {
      if (done.has(list)) continue;
      await this.db
        .insert(workforceListItem)
        .values(
          items.map((item, index) => ({
            id: generateId(),
            companyId,
            list,
            seedKey: item.key,
            name: item.name,
            nameKey: workforceKey(item.name),
            position: index + 1,
            active: true,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing()
        .run();
    }
  }

  async items(
    companyId: string,
    list: WorkforceList,
    options: { includeInactive: boolean; withUsage: boolean },
  ): Promise<WorkforceListItemDto[]> {
    await this.ensureSeeded(companyId);
    const rows = await this.rows(companyId, list);
    const visible = rows.filter((row) => options.includeInactive || row.active);
    const usage = options.withUsage
      ? await this.usage(
          list,
          visible.map((row) => row.id),
        )
      : null;
    return visible.map((row) => ({
      ...listItemRef(row),
      list: row.list,
      active: row.active,
      position: row.position,
      ...(usage ? { usage: usage.get(row.id) ?? 0 } : {}),
    }));
  }

  /** Items by id (any list), for names on profiles and records. */
  async byIds(
    companyId: string,
    ids: readonly (string | null)[],
  ): Promise<Map<string, WorkforceListItemRow>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(workforceListItem)
      .where(and(eq(workforceListItem.companyId, companyId), inArray(workforceListItem.id, unique)))
      .all();
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * An item a record may point to: in the company and list, and active unless it is the value
   * the record already has (PLT-21 rules).
   */
  async requireUsable(
    companyId: string,
    list: WorkforceList,
    id: string,
    currentId: string | null = null,
  ): Promise<WorkforceListItemRow> {
    await this.ensureSeeded(companyId);
    const row = (await this.byIds(companyId, [id])).get(id);
    if (row?.list !== list) throw new ListItemInactiveError();
    if (!row.active && row.id !== currentId) throw new ListItemInactiveError();
    return row;
  }

  async create(
    companyId: string,
    principal: Principal,
    list: WorkforceList,
    name: string,
  ): Promise<WorkforceListItemDto> {
    await this.ensureSeeded(companyId);
    const rows = await this.rows(companyId, list);
    if (rows.length >= WORKFORCE_LIMITS.listItemsMax) {
      throw new ListLimitReachedError(WORKFORCE_LIMITS.listItemsMax);
    }
    const nameKey = workforceKey(name);
    if (rows.some((row) => row.nameKey === nameKey)) throw new ListItemNameTakenError();
    const id = generateId();
    const now = new Date(this.deps.clock());
    await new UnitOfWork(this.db)
      .add(
        this.db.insert(workforceListItem).values({
          id,
          companyId,
          list,
          seedKey: null,
          name,
          nameKey,
          position: (rows.at(-1)?.position ?? 0) + 1,
          active: true,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        this.entry('created', companyId, principal, id, null, { list, name }),
      )
      .commit();
    return this.dto(await this.required(companyId, list, id));
  }

  async rename(
    companyId: string,
    principal: Principal,
    list: WorkforceList,
    id: string,
    name: string,
  ): Promise<WorkforceListItemDto> {
    const current = await this.required(companyId, list, id);
    if (current.name === name) return this.dto(current);
    const nameKey = workforceKey(name);
    const rows = await this.rows(companyId, list);
    if (rows.some((row) => row.id !== id && row.nameKey === nameKey)) {
      throw new ListItemNameTakenError();
    }
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(workforceListItem)
          .set({
            name,
            nameKey,
            updatedAt: new Date(this.deps.clock()),
            updatedBy: principal.userId,
          })
          .where(eq(workforceListItem.id, id)),
        this.entry('renamed', companyId, principal, id, { name: current.name }, { list, name }),
      )
      .commit();
    return this.dto(await this.required(companyId, list, id));
  }

  async move(
    companyId: string,
    principal: Principal,
    list: WorkforceList,
    id: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    const current = await this.required(companyId, list, id);
    const rows = await this.rows(companyId, list);
    const index = rows.findIndex((row) => row.id === current.id);
    const neighbour = rows[direction === 'up' ? index - 1 : index + 1];
    if (!neighbour) return;
    const now = new Date(this.deps.clock());
    const setPosition = (rowId: string, position: number) =>
      this.db
        .update(workforceListItem)
        .set({ position, updatedAt: now, updatedBy: principal.userId })
        .where(eq(workforceListItem.id, rowId));
    await new UnitOfWork(this.db)
      .add(
        setPosition(current.id, neighbour.position),
        setPosition(neighbour.id, current.position),
        this.entry('moved', companyId, principal, id, null, { list, direction }),
      )
      .commit();
  }

  async setActive(
    companyId: string,
    principal: Principal,
    list: WorkforceList,
    id: string,
    active: boolean,
  ): Promise<void> {
    const current = await this.required(companyId, list, id);
    if (current.active === active) return;
    await new UnitOfWork(this.db)
      .add(
        this.db
          .update(workforceListItem)
          .set({ active, updatedAt: new Date(this.deps.clock()), updatedBy: principal.userId })
          .where(eq(workforceListItem.id, id)),
        this.entry(active ? 'reactivated' : 'deactivated', companyId, principal, id, null, {
          list,
          name: current.name,
        }),
      )
      .commit();
  }

  /** Only unused custom items; seeded and used ones are deactivated instead. */
  async delete(
    companyId: string,
    principal: Principal,
    list: WorkforceList,
    id: string,
  ): Promise<void> {
    const current = await this.required(companyId, list, id);
    const used = (await this.usage(list, [id])).get(id) ?? 0;
    if (used > 0 || current.seedKey) throw new ListItemInUseError(used);
    await new UnitOfWork(this.db)
      .add(
        this.db.delete(workforceListItem).where(eq(workforceListItem.id, id)),
        this.entry('deleted', companyId, principal, id, { list, name: current.name }, null),
      )
      .commit();
  }

  private rows(companyId: string, list: WorkforceList): Promise<WorkforceListItemRow[]> {
    return this.db
      .select()
      .from(workforceListItem)
      .where(and(eq(workforceListItem.companyId, companyId), eq(workforceListItem.list, list)))
      .orderBy(asc(workforceListItem.position))
      .all();
  }

  private async required(
    companyId: string,
    list: WorkforceList,
    id: string,
  ): Promise<WorkforceListItemRow> {
    const row = (await this.byIds(companyId, [id])).get(id);
    if (row?.list !== list) throw new NotFoundError();
    return row;
  }

  /** How many profiles, assignments or records use each item. */
  private async usage(list: WorkforceList, ids: readonly string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (ids.length === 0) return result;
    const add = (rows: { id: string | null; value: number }[]) => {
      for (const row of rows) if (row.id) result.set(row.id, (result.get(row.id) ?? 0) + row.value);
    };
    if (list === 'job_position') {
      add(
        await this.db
          .select({ id: workforceMember.jobPositionId, value: sql<number>`count(*)` })
          .from(workforceMember)
          .where(inArray(workforceMember.jobPositionId, [...ids]))
          .groupBy(workforceMember.jobPositionId)
          .all(),
      );
      add(
        await this.db
          .select({ id: workforceAssignment.jobPositionId, value: sql<number>`count(*)` })
          .from(workforceAssignment)
          .where(inArray(workforceAssignment.jobPositionId, [...ids]))
          .groupBy(workforceAssignment.jobPositionId)
          .all(),
      );
    } else {
      add(
        await this.db
          .select({ id: workforceRecord.competencyId, value: sql<number>`count(*)` })
          .from(workforceRecord)
          .where(inArray(workforceRecord.competencyId, [...ids]))
          .groupBy(workforceRecord.competencyId)
          .all(),
      );
    }
    return result;
  }

  private dto(row: WorkforceListItemRow): WorkforceListItemDto {
    return { ...listItemRef(row), list: row.list, active: row.active, position: row.position };
  }

  private entry(
    verb: 'created' | 'renamed' | 'moved' | 'deactivated' | 'reactivated' | 'deleted',
    companyId: string,
    principal: Principal,
    id: string,
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
  ) {
    return this.audit.entry({
      action: `workforce.list_item.${verb}` as AuditAction,
      actorUserId: principal.userId,
      companyId,
      entityType: 'workforce_list_item',
      entityId: id,
      oldValue,
      newValue,
    });
  }
}
