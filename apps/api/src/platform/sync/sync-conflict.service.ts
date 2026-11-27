import {
  generateId,
  type ResolveConflictResultDto,
  type SyncConflictChoice,
  type SyncConflictDto,
  type SyncConflictStatus,
  type SyncConflictSummaryDto,
} from '@hse/shared';
import { and, desc, eq, lte } from 'drizzle-orm';

import type { Principal } from '../../core/auth/principal';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { AuditLogService } from '../audit-log';
import { NotificationService } from '../notification';
import type { OfflineMeta } from './offline-meta';
import { isVersionGuardFailure, type SyncEntity, type SyncSnapshot, syncEntity } from './sync-entities';
import { syncConflict, type SyncConflictRow } from './sync.schema';
import { SyncConflictError, SyncConflictResolvedError } from './sync.errors';

export interface DetectInput {
  companyId: string;
  userId: string;
  entity: SyncEntity;
  entityId: string;
  baseVersion: number;
  clientPayload: Record<string, unknown>;
  snapshot: SyncSnapshot;
}

function parse(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pick(values: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) if (field in values) result[field] = values[field];
  return result;
}

/** PLT-30 (T-70, D-20): conflicts are kept on the server and resolved by their author. */
export class SyncConflictService {
  private readonly audit: AuditLogService;
  private readonly notifications: NotificationService;

  constructor(
    private readonly db: Database,
    private readonly meta: RequestMeta,
    private readonly clock: () => number = Date.now,
  ) {
    this.audit = new AuditLogService(db, meta, clock);
    this.notifications = new NotificationService(db, clock);
  }

  // ---- Detection ------------------------------------------------------------------------

  private detectStatements(input: DetectInput, id: string): Statement[] {
    const now = new Date(this.clock());
    return [
      this.db.insert(syncConflict).values({
        id,
        companyId: input.companyId,
        projectId: input.snapshot.projectId,
        userId: input.userId,
        entityType: input.entity.type,
        entityId: input.entityId,
        label: input.snapshot.label.slice(0, 200),
        projectCode: input.snapshot.projectCode,
        baseVersion: input.baseVersion,
        serverVersion: input.snapshot.version,
        changedBy: input.snapshot.changedBy,
        clientPayload: JSON.stringify(input.clientPayload),
        serverSnapshot: JSON.stringify(input.snapshot.values),
        status: 'open',
        createdAt: now,
      }),
      this.audit.entry({
        action: 'sync.conflict_detected',
        actorUserId: input.userId,
        companyId: input.companyId,
        projectId: input.snapshot.projectId,
        entityType: input.entity.type,
        entityId: input.entityId,
        newValue: {
          conflictId: id,
          baseVersion: input.baseVersion,
          serverVersion: input.snapshot.version,
        },
      }),
      // O-131: seen on any device. The user caused it, but it is the system that tells them.
      ...this.notifications.entries({
        type: 'sync.conflict',
        companyId: input.companyId,
        projectId: input.snapshot.projectId,
        entityType: 'sync_conflict',
        entityId: id,
        actorUserId: null,
        params: {
          recordLabel: input.snapshot.label.slice(0, 80),
          conflictId: id,
          ...(input.snapshot.projectCode ? { projectCode: input.snapshot.projectCode } : {}),
        },
        recipients: [input.userId],
      }),
    ];
  }

  /** Records the conflict and returns the error to throw (nothing of the change applied). */
  async detect(input: DetectInput, extra: Statement[] = []): Promise<SyncConflictError> {
    const id = generateId();
    await new UnitOfWork(this.db).add(...this.detectStatements(input, id), ...extra).commit();
    return new SyncConflictError(id, input.snapshot.version);
  }

  // ---- Reading --------------------------------------------------------------------------

  private async own(companyId: string, userId: string, id: string): Promise<SyncConflictRow> {
    const row = await this.db
      .select()
      .from(syncConflict)
      .where(
        and(
          eq(syncConflict.id, id),
          eq(syncConflict.companyId, companyId),
          eq(syncConflict.userId, userId),
        ),
      )
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  async list(
    companyId: string,
    userId: string,
    status: SyncConflictStatus,
  ): Promise<{ items: SyncConflictSummaryDto[] }> {
    const rows = await this.db
      .select()
      .from(syncConflict)
      .where(
        and(
          eq(syncConflict.companyId, companyId),
          eq(syncConflict.userId, userId),
          eq(syncConflict.status, status),
        ),
      )
      .orderBy(desc(syncConflict.createdAt))
      .limit(100)
      .all();
    return { items: rows.map(toSummary) };
  }

  async get(companyId: string, userId: string, id: string): Promise<SyncConflictDto> {
    return toDto(await this.own(companyId, userId, id));
  }

  /** O-131: open conflicts created before this time (reminder job). */
  openBefore(before: number, limit = 500): Promise<SyncConflictRow[]> {
    return this.db
      .select()
      .from(syncConflict)
      .where(and(eq(syncConflict.status, 'open'), lte(syncConflict.createdAt, new Date(before))))
      .limit(limit)
      .all();
  }

  // ---- Resolution (O-122) ----------------------------------------------------------------

  private closeStatements(
    row: SyncConflictRow,
    status: SyncConflictStatus,
    resolution: SyncConflictChoice | null,
    values: Record<string, unknown> | null,
  ): Statement[] {
    return [
      this.db
        .update(syncConflict)
        .set({
          status,
          resolution,
          resolvedValues: values ? JSON.stringify(values) : null,
          resolvedAt: new Date(this.clock()),
        })
        .where(and(eq(syncConflict.id, row.id), eq(syncConflict.status, 'open'))),
      this.audit.entry({
        action: 'sync.conflict_resolved',
        actorUserId: row.userId,
        companyId: row.companyId,
        projectId: row.projectId,
        entityType: row.entityType,
        entityId: row.entityId,
        newValue: { conflictId: row.id, status, resolution },
      }),
    ];
  }

  async resolve(
    companyId: string,
    principal: Principal,
    id: string,
    choice: SyncConflictChoice,
    combined: Record<string, unknown> | undefined,
    offline: OfflineMeta | null,
  ): Promise<ResolveConflictResultDto> {
    const row = await this.own(companyId, principal.userId, id);
    if (row.status !== 'open') throw new SyncConflictResolvedError();
    const entity = syncEntity(row.entityType);
    if (!entity) throw new NotFoundError();

    if (choice === 'theirs') {
      await new UnitOfWork(this.db).add(...this.closeStatements(row, 'discarded', 'theirs', null)).commit();
      const snapshot = await entity.snapshot(this.db, companyId, row.entityId);
      return { status: 'discarded', record: snapshot?.values ?? null };
    }

    const values =
      choice === 'mine'
        ? pick(parse(row.clientPayload), entity.conflictFields)
        : this.combined(entity, combined ?? {});

    const snapshot = await entity.snapshot(this.db, companyId, row.entityId);
    if (!snapshot) throw new NotFoundError();
    if (snapshot.version !== row.serverVersion) throw await this.supersede(row, entity, values, snapshot);

    const prepared = await entity.prepareUpdate({
      db: this.db,
      companyId,
      principal,
      entityId: row.entityId,
      values,
      expectVersion: snapshot.version,
      offline,
      meta: this.meta,
      now: this.clock(),
    });
    try {
      await new UnitOfWork(this.db)
        .add(...prepared.statements, ...this.closeStatements(row, 'resolved', choice, values))
        .commit();
    } catch (error) {
      if (!isVersionGuardFailure(error)) throw error;
      const latest = await entity.snapshot(this.db, companyId, row.entityId);
      if (!latest) throw new NotFoundError();
      throw await this.supersede(row, entity, values, latest);
    }
    return { status: 'resolved', record: prepared.record };
  }

  private combined(entity: SyncEntity, values: Record<string, unknown>): Record<string, unknown> {
    const unknown = Object.keys(values).filter((field) => !entity.conflictFields.includes(field));
    if (unknown.length > 0) {
      throw new ValidationError(
        unknown.map((field) => ({ path: `values.${field}`, message: 'This field cannot be combined.' })),
      );
    }
    return values;
  }

  /** The record changed again: a new conflict replaces this one (status `superseded`). */
  private async supersede(
    row: SyncConflictRow,
    entity: SyncEntity,
    values: Record<string, unknown>,
    snapshot: SyncSnapshot,
  ): Promise<SyncConflictError> {
    const id = generateId();
    await new UnitOfWork(this.db)
      .add(
        ...this.closeStatements(row, 'superseded', null, null),
        ...this.detectStatements(
          {
            companyId: row.companyId,
            userId: row.userId,
            entity,
            entityId: row.entityId,
            baseVersion: row.serverVersion,
            clientPayload: values,
            snapshot,
          },
          id,
        ),
      )
      .commit();
    return new SyncConflictError(id, snapshot.version);
  }
}

function toSummary(row: SyncConflictRow): SyncConflictSummaryDto {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    label: row.label,
    projectCode: row.projectCode,
    serverVersion: row.serverVersion,
    changedBy: row.changedBy,
    createdAt: row.createdAt.getTime(),
    status: row.status,
  };
}

function toDto(row: SyncConflictRow): SyncConflictDto {
  return {
    ...toSummary(row),
    baseVersion: row.baseVersion,
    fields: [...(syncEntity(row.entityType)?.conflictFields ?? [])],
    clientPayload: parse(row.clientPayload),
    serverSnapshot: parse(row.serverSnapshot),
    resolution: row.resolution,
    resolvedAt: row.resolvedAt?.getTime() ?? null,
  };
}
