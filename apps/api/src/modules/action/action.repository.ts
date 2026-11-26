import {
  ACTION_PAGE_SIZE,
  type ActionDueState,
  type ActionPriority,
  type ActionStatus,
  type ActionType,
  addIsoDays,
  ACTION_DUE_SOON_DAYS,
  normalizeSearchText,
  parseActionNumber,
} from '@hse/shared';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { file } from '../../platform/file-storage';
import {
  action,
  actionCollaborator,
  type ActionCollaboratorRow,
  actionFile,
  actionOwnerHistory,
  type ActionOwnerHistoryRow,
  type ActionRow,
  actionUpdate,
  type ActionUpdateRow,
} from './action.schema';

export interface ActionFileView {
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  addedBy: string;
  addedAt: Date;
}

/** Who the list is for (T-65): everything, or only the caller's own actions. */
export type ListScope = { all: true } | { all: false; userId: string };

export interface ActionFilters {
  statuses: readonly ActionStatus[];
  due: readonly Exclude<ActionDueState, 'done'>[];
  priorities: readonly ActionPriority[];
  types: readonly ActionType[];
  ownerId?: string | undefined;
  placeId?: string | undefined;
  source?: string | undefined;
  ownerIds?: readonly string[] | undefined;
  voided: boolean;
  search?: string | undefined;
}

const ACTIVE: ActionStatus[] = ['open', 'in_progress'];
/** Overdue first (earliest due dates of active actions), then by due date and priority. */
const ORDER = [
  sql`case when ${action.status} in ('open', 'in_progress') then 0 else 1 end`,
  asc(action.dueOn),
  sql`case ${action.priority} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
  desc(action.number),
];

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/** T-59: a due state as a date condition on active actions. */
function dueCondition(state: Exclude<ActionDueState, 'done'>, today: string): SQL | undefined {
  const active = inArray(action.status, ACTIVE);
  const soon = addIsoDays(today, ACTION_DUE_SOON_DAYS);
  switch (state) {
    case 'overdue':
      return and(active, lt(action.dueOn, today));
    case 'due_today':
      return and(active, eq(action.dueOn, today));
    case 'due_soon':
      return and(active, sql`${action.dueOn} > ${today}`, lte(action.dueOn, soon));
    case 'on_track':
      return and(active, sql`${action.dueOn} > ${soon}`);
  }
}

export class ActionRepository {
  constructor(private readonly db: Database) {}

  find(companyId: string, projectId: string, id: string): Promise<ActionRow | undefined> {
    return this.db
      .select()
      .from(action)
      .where(and(eq(action.id, id), eq(action.companyId, companyId), eq(action.projectId, projectId)))
      .get();
  }

  findMany(companyId: string, ids: readonly string[]): Promise<ActionRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(action)
      .where(and(eq(action.companyId, companyId), inArray(action.id, [...ids])))
      .all();
  }

  insert(row: ActionRow): Statement {
    return this.db.insert(action).values(row);
  }

  /** A conditional update: changes nothing unless the action is still in one of `from` (T-58). */
  updateIf(
    id: string,
    from: readonly ActionStatus[],
    values: Partial<ActionRow>,
    options: { notVoided?: boolean } = {},
  ): Statement {
    return this.db
      .update(action)
      .set(values)
      .where(
        and(
          eq(action.id, id),
          inArray(action.status, [...from]),
          options.notVoided === false ? undefined : isNull(action.voidedAt),
        ),
      );
  }

  /**
   * T-58: a statement that fails the batch (SQLite raises "malformed JSON" on `json('…')`)
   * unless the action carries this `updated_at` stamp (and status), i.e. unless the conditional
   * update before it applied. D1 runs a batch as one transaction, so nothing else is written.
   */
  guard(id: string, updatedAt: Date, status?: ActionStatus): Statement {
    const statusCheck = status ? sql` and ${action.status} = ${status}` : sql``;
    return this.db
      .select({
        ok: sql<number>`case when ${action.updatedAt} = ${updatedAt.getTime()}${statusCheck} then 1 else json('action changed') end`,
      })
      .from(action)
      .where(eq(action.id, id));
  }

  async statusOf(id: string): Promise<{ status: ActionStatus; updatedAt: Date } | undefined> {
    return this.db
      .select({ status: action.status, updatedAt: action.updatedAt })
      .from(action)
      .where(eq(action.id, id))
      .get();
  }

  // ---- Owners and collaborators -------------------------------------------------------

  ownerHistory(actionId: string): Promise<ActionOwnerHistoryRow[]> {
    return this.db
      .select()
      .from(actionOwnerHistory)
      .where(eq(actionOwnerHistory.actionId, actionId))
      .orderBy(desc(actionOwnerHistory.fromAt))
      .all();
  }

  openOwnerHistory(row: Omit<ActionOwnerHistoryRow, 'toAt'>): Statement {
    return this.db.insert(actionOwnerHistory).values({ ...row, toAt: null });
  }

  closeOwnerHistory(actionId: string, at: Date): Statement {
    return this.db
      .update(actionOwnerHistory)
      .set({ toAt: at })
      .where(and(eq(actionOwnerHistory.actionId, actionId), isNull(actionOwnerHistory.toAt)));
  }

  /** Current collaborators of several actions. */
  async collaboratorsOf(actionIds: readonly string[]): Promise<ActionCollaboratorRow[]> {
    if (actionIds.length === 0) return [];
    return this.db
      .select()
      .from(actionCollaborator)
      .where(
        and(inArray(actionCollaborator.actionId, [...actionIds]), isNull(actionCollaborator.removedAt)),
      )
      .orderBy(asc(actionCollaborator.addedAt))
      .all();
  }

  addCollaborator(row: ActionCollaboratorRow): Statement {
    return this.db.insert(actionCollaborator).values(row);
  }

  removeCollaborator(actionId: string, userId: string, at: Date, by: string | null): Statement {
    return this.db
      .update(actionCollaborator)
      .set({ removedAt: at, removedBy: by })
      .where(
        and(
          eq(actionCollaborator.actionId, actionId),
          eq(actionCollaborator.userId, userId),
          isNull(actionCollaborator.removedAt),
        ),
      );
  }

  /** Action ids where the user collaborates now. */
  async collaboratingIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: actionCollaborator.actionId })
      .from(actionCollaborator)
      .where(and(eq(actionCollaborator.userId, userId), isNull(actionCollaborator.removedAt)))
      .all();
    return rows.map((row) => row.id);
  }

  // ---- Updates and files ----------------------------------------------------------------

  updates(actionId: string): Promise<ActionUpdateRow[]> {
    return this.db
      .select()
      .from(actionUpdate)
      .where(eq(actionUpdate.actionId, actionId))
      .orderBy(desc(actionUpdate.createdAt), desc(actionUpdate.id))
      .all();
  }

  insertUpdate(row: ActionUpdateRow): Statement {
    return this.db.insert(actionUpdate).values(row);
  }

  /** The latest send-back reason (shown to the owner while In Progress again). */
  async latestSendBack(actionId: string): Promise<string | null> {
    const row = await this.db
      .select({ note: actionUpdate.note })
      .from(actionUpdate)
      .where(and(eq(actionUpdate.actionId, actionId), eq(actionUpdate.kind, 'send_back')))
      .orderBy(desc(actionUpdate.createdAt))
      .limit(1)
      .get();
    return row?.note ?? null;
  }

  /** The last progress percent before completion (restored on send-back). */
  async lastProgressPercent(actionId: string): Promise<number | null> {
    const row = await this.db
      .select({ percent: actionUpdate.percent })
      .from(actionUpdate)
      .where(
        and(
          eq(actionUpdate.actionId, actionId),
          eq(actionUpdate.kind, 'progress'),
          isNotNull(actionUpdate.percent),
        ),
      )
      .orderBy(desc(actionUpdate.createdAt))
      .limit(1)
      .get();
    return row?.percent ?? null;
  }

  async files(actionId: string): Promise<ActionFileView[]> {
    return this.db
      .select({
        fileId: actionFile.fileId,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        addedBy: actionFile.addedBy,
        addedAt: actionFile.addedAt,
      })
      .from(actionFile)
      .innerJoin(file, eq(file.id, actionFile.fileId))
      .where(and(eq(actionFile.actionId, actionId), isNull(file.deletedAt)))
      .orderBy(asc(actionFile.addedAt))
      .all();
  }

  async fileCount(actionId: string): Promise<number> {
    const row = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(actionFile)
      .where(eq(actionFile.actionId, actionId))
      .get();
    return row?.value ?? 0;
  }

  addFile(actionId: string, fileId: string, addedBy: string, addedAt: Date): Statement {
    return this.db
      .insert(actionFile)
      .values({ actionId, fileId, kind: 'evidence', addedBy, addedAt });
  }

  async hasFile(actionId: string, fileId: string): Promise<boolean> {
    const row = await this.db
      .select({ id: actionFile.fileId })
      .from(actionFile)
      .where(and(eq(actionFile.actionId, actionId), eq(actionFile.fileId, fileId)))
      .get();
    return row !== undefined;
  }

  /** Actions created as follow-ups of this one (O-97). */
  followUps(companyId: string, actionId: string): Promise<ActionRow[]> {
    return this.db
      .select()
      .from(action)
      .where(
        and(
          eq(action.companyId, companyId),
          eq(action.sourceModule, 'action'),
          eq(action.sourceRecordId, actionId),
        ),
      )
      .orderBy(asc(action.number))
      .all();
  }

  // ---- Lists (PLT-24) -------------------------------------------------------------------

  private filterConditions(filters: ActionFilters, today: string): SQL[] {
    const conditions: SQL[] = [];
    if (!filters.voided) conditions.push(isNull(action.voidedAt));
    if (filters.statuses.length > 0) conditions.push(inArray(action.status, [...filters.statuses]));
    else if (!filters.voided) conditions.push(ne(action.status, 'closed'));
    if (filters.due.length > 0) {
      const due = or(...filters.due.map((state) => dueCondition(state, today)));
      if (due) conditions.push(due);
    }
    if (filters.priorities.length > 0) {
      conditions.push(inArray(action.priority, [...filters.priorities]));
    }
    if (filters.types.length > 0) conditions.push(inArray(action.type, [...filters.types]));
    if (filters.ownerId) conditions.push(eq(action.ownerId, filters.ownerId));
    if (filters.ownerIds) conditions.push(inArray(action.ownerId, [...filters.ownerIds]));
    if (filters.source) conditions.push(eq(action.sourceModule, filters.source));
    if (filters.placeId) {
      const place = or(
        eq(action.areaId, filters.placeId),
        eq(action.locationId, filters.placeId),
        eq(action.workZoneId, filters.placeId),
      );
      if (place) conditions.push(place);
    }
    if (filters.search) {
      const number = parseActionNumber(filters.search);
      const pattern = `%${escapeLike(normalizeSearchText(filters.search))}%`;
      const text = sql`${action.searchKey} like ${pattern} escape '\\'`;
      const search = number === null ? text : or(text, eq(action.number, number));
      if (search) conditions.push(search);
    }
    return conditions;
  }

  private async scopeCondition(scope: ListScope): Promise<SQL | undefined> {
    if (scope.all) return undefined;
    const collaborating = await this.collaboratingIds(scope.userId);
    return or(
      eq(action.ownerId, scope.userId),
      eq(action.createdBy, scope.userId),
      collaborating.length > 0 ? inArray(action.id, collaborating) : undefined,
    );
  }

  async listForProject(
    companyId: string,
    projectId: string,
    scope: ListScope,
    filters: ActionFilters,
    today: string,
    offset: number,
  ): Promise<{ rows: ActionRow[]; next: number | null }> {
    const scoped = await this.scopeCondition(scope);
    const rows = await this.db
      .select()
      .from(action)
      .where(
        and(
          eq(action.companyId, companyId),
          eq(action.projectId, projectId),
          scoped,
          ...this.filterConditions(filters, today),
        ),
      )
      .orderBy(...ORDER)
      .limit(ACTION_PAGE_SIZE + 1)
      .offset(offset)
      .all();
    return {
      rows: rows.slice(0, ACTION_PAGE_SIZE),
      next: rows.length > ACTION_PAGE_SIZE ? offset + ACTION_PAGE_SIZE : null,
    };
  }

  /** Distinct owners of a project's actions that aren't closed (for "Owner has no access"). */
  async ownersOf(projectId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ ownerId: action.ownerId })
      .from(action)
      .where(and(eq(action.projectId, projectId), ne(action.status, 'closed'), isNull(action.voidedAt)))
      .all();
    return rows.map((row) => row.ownerId);
  }

  async summary(
    companyId: string,
    projectId: string,
    scope: ListScope,
    today: string,
    verifyExcluding: string | null,
  ): Promise<{ open: number; overdue: number; dueToday: number; toVerify: number; closed: number }> {
    const scoped = await this.scopeCondition(scope);
    const collaborating = verifyExcluding ? await this.collaboratingIds(verifyExcluding) : [];
    const notMine = verifyExcluding
      ? and(
          ne(action.ownerId, verifyExcluding),
          collaborating.length > 0 ? notInArray(action.id, collaborating) : undefined,
        )
      : undefined;
    const row = await this.db
      .select({
        open: sql<number>`sum(case when ${action.status} in ('open', 'in_progress') then 1 else 0 end)`,
        overdue: sql<number>`sum(case when ${action.status} in ('open', 'in_progress') and ${action.dueOn} < ${today} then 1 else 0 end)`,
        dueToday: sql<number>`sum(case when ${action.status} in ('open', 'in_progress') and ${action.dueOn} = ${today} then 1 else 0 end)`,
        completed: sql<number>`sum(case when ${action.status} = 'completed' then 1 else 0 end)`,
        closed: sql<number>`sum(case when ${action.status} = 'closed' then 1 else 0 end)`,
      })
      .from(action)
      .where(
        and(
          eq(action.companyId, companyId),
          eq(action.projectId, projectId),
          isNull(action.voidedAt),
          scoped,
        ),
      )
      .get();
    let toVerify = 0;
    if (verifyExcluding) {
      const verify = await this.db
        .select({ value: sql<number>`count(*)` })
        .from(action)
        .where(
          and(
            eq(action.companyId, companyId),
            eq(action.projectId, projectId),
            isNull(action.voidedAt),
            eq(action.status, 'completed'),
            notMine,
          ),
        )
        .get();
      toVerify = verify?.value ?? 0;
    }
    return {
      open: row?.open ?? 0,
      overdue: row?.overdue ?? 0,
      dueToday: row?.dueToday ?? 0,
      toVerify,
      closed: row?.closed ?? 0,
    };
  }

  /** My actions (PLT-24): `projectIds` = projects the caller can view now (null = all). */
  async listMine(
    companyId: string,
    userId: string,
    tab: 'owned' | 'collaborating' | 'verify',
    options: {
      projectIds: readonly string[] | null;
      verifyProjectIds: readonly string[] | null;
      due: readonly Exclude<ActionDueState, 'done'>[];
      today: string;
      offset: number;
      limit?: number;
    },
  ): Promise<{ rows: ActionRow[]; next: number | null; total: number }> {
    const condition = await this.mineCondition(companyId, userId, tab, options);
    if (!condition) return { rows: [], next: null, total: 0 };
    const due =
      options.due.length > 0 ? or(...options.due.map((s) => dueCondition(s, options.today))) : undefined;
    const limit = options.limit ?? ACTION_PAGE_SIZE;
    const where = and(condition, due);
    const [rows, count] = await Promise.all([
      this.db
        .select()
        .from(action)
        .where(where)
        .orderBy(...ORDER)
        .limit(limit + 1)
        .offset(options.offset)
        .all(),
      this.db.select({ value: sql<number>`count(*)` }).from(action).where(where).get(),
    ]);
    return {
      rows: rows.slice(0, limit),
      next: rows.length > limit ? options.offset + limit : null,
      total: count?.value ?? 0,
    };
  }

  private async mineCondition(
    companyId: string,
    userId: string,
    tab: 'owned' | 'collaborating' | 'verify',
    options: { projectIds: readonly string[] | null; verifyProjectIds: readonly string[] | null },
  ): Promise<SQL | undefined> {
    const base: (SQL | undefined)[] = [eq(action.companyId, companyId), isNull(action.voidedAt)];
    if (options.projectIds !== null) {
      if (options.projectIds.length === 0) return undefined;
      base.push(inArray(action.projectId, [...options.projectIds]));
    }
    const collaborating = await this.collaboratingIds(userId);
    switch (tab) {
      case 'owned':
        return and(...base, eq(action.ownerId, userId), ne(action.status, 'closed'));
      case 'collaborating':
        if (collaborating.length === 0) return undefined;
        return and(...base, inArray(action.id, collaborating), ne(action.status, 'closed'));
      case 'verify': {
        if (options.verifyProjectIds !== null && options.verifyProjectIds.length === 0) {
          return undefined;
        }
        return and(
          ...base,
          eq(action.status, 'completed'),
          ne(action.ownerId, userId),
          collaborating.length > 0 ? notInArray(action.id, collaborating) : undefined,
          options.verifyProjectIds === null
            ? undefined
            : inArray(action.projectId, [...options.verifyProjectIds]),
        );
      }
    }
  }

  // ---- Places (O-112) and the daily job (T-64) ------------------------------------------

  async countUsingPlace(placeId: string): Promise<number> {
    const row = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(action)
      .where(
        or(eq(action.areaId, placeId), eq(action.locationId, placeId), eq(action.workZoneId, placeId)),
      )
      .get();
    return row?.value ?? 0;
  }

  /** Active, not voided actions due on or before `until` (company dates are within a day). */
  activeDueUntil(until: string): Promise<ActionRow[]> {
    return this.db
      .select()
      .from(action)
      .where(and(inArray(action.status, ACTIVE), isNull(action.voidedAt), lte(action.dueOn, until)))
      .all();
  }

  /** Every action whose owner should still have access (Open, In Progress, Completed). */
  ownedNotFinished(after: string | null, limit: number): Promise<ActionRow[]> {
    return this.db
      .select()
      .from(action)
      .where(
        and(
          inArray(action.status, ['open', 'in_progress', 'completed']),
          isNull(action.voidedAt),
          after ? gt(action.id, after) : undefined,
        ),
      )
      .orderBy(asc(action.id))
      .limit(limit)
      .all();
  }
}
