import {
  type CreateSyncProbeRequest,
  OFFLINE_LIMITS,
  SYNC_PROBE_CONFLICT_FIELDS,
  type SyncProbeDto,
  updateSyncProbeRequestSchema,
} from '@hse/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { Principal } from '../../core/auth/principal';
import type { IdempotencyClaim } from '../../core/context/app-context';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/app-error';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { AuditLogService } from '../../platform/audit-log';
import { FileStorageService, type OpenedFile } from '../../platform/file-storage';
import {
  IdempotencyService,
  isVersionGuardFailure,
  offlineAudit,
  type OfflineMeta,
  type PreparedUpdate,
  type PrepareUpdateInput,
  RecordIdTakenError,
  SyncConflictError,
  SyncConflictService,
  type SyncEntity,
  type SyncSnapshot,
} from '../../platform/sync';
import { PlanLimitService, SubscriptionService } from '../subscription';
import { ensureProbeTables, syncProbe, syncProbePhoto, type SyncProbeRow } from './sync-probe.tables';

export const SYNC_PROBE_TYPE = 'dev.sync_probe';

export interface ProbeDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  /** Only needed for photos. */
  bucket?: R2Bucket;
}

type CreateInput = Required<Pick<CreateSyncProbeRequest, 'title'>> & {
  id?: string | undefined;
  note: string;
};

interface UpdateValues {
  title?: string | undefined;
  note?: string | undefined;
}

/** A created or replayed probe and whether it already existed (T-68). */
export interface ProbeResult {
  dto: SyncProbeDto;
  replayed: boolean;
}

function label(row: Pick<SyncProbeRow, 'title'>): string {
  return `Sync probe ${row.title}`;
}

/**
 * O-116: a small offline-capable record used to prove the sync layer before inspections exist
 * (development and test builds only). Only its creator sees it.
 */
export class SyncProbeService {
  private readonly audit: AuditLogService;
  private readonly keys: IdempotencyService;

  constructor(private readonly deps: ProbeDeps) {
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.keys = new IdempotencyService(deps.db, deps.clock);
  }

  private get files(): FileStorageService {
    if (!this.deps.bucket) throw new Error('File storage is not available here');
    return new FileStorageService(this.deps.db, this.deps.bucket, this.deps.clock);
  }

  private get db(): Database {
    return this.deps.db;
  }

  ready(): Promise<void> {
    return ensureProbeTables(this.db);
  }

  private find(companyId: string, id: string): Promise<SyncProbeRow | undefined> {
    return this.db
      .select()
      .from(syncProbe)
      .where(and(eq(syncProbe.companyId, companyId), eq(syncProbe.id, id)))
      .get();
  }

  private async own(companyId: string, principal: Principal, id: string): Promise<SyncProbeRow> {
    const row = await this.find(companyId, id);
    if (row?.createdBy !== principal.userId) throw new NotFoundError();
    return row;
  }

  private async toDto(row: SyncProbeRow): Promise<SyncProbeDto> {
    const photos = await this.db
      .select({ fileId: syncProbePhoto.fileId })
      .from(syncProbePhoto)
      .where(eq(syncProbePhoto.probeId, row.id))
      .orderBy(asc(syncProbePhoto.createdAt), asc(syncProbePhoto.id))
      .all();
    return {
      id: row.id,
      title: row.title,
      note: row.note,
      version: row.version,
      photoIds: photos.map((photo) => photo.fileId),
      capturedAt: row.capturedAt.getTime(),
      receivedAt: row.receivedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async get(companyId: string, principal: Principal, id: string): Promise<SyncProbeDto> {
    return this.toDto(await this.own(companyId, principal, id));
  }

  async list(companyId: string, principal: Principal): Promise<{ items: SyncProbeDto[] }> {
    const rows = await this.db
      .select()
      .from(syncProbe)
      .where(and(eq(syncProbe.companyId, companyId), eq(syncProbe.createdBy, principal.userId)))
      .orderBy(desc(syncProbe.updatedAt))
      .limit(50)
      .all();
    return { items: await Promise.all(rows.map((row) => this.toDto(row))) };
  }

  // ---- Create (T-68: the id may come from the device) -----------------------------------

  async create(
    companyId: string,
    principal: Principal,
    input: CreateInput,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<ProbeResult> {
    if (input.id) {
      const existing = await this.db.select().from(syncProbe).where(eq(syncProbe.id, input.id)).get();
      if (existing) {
        // A lost answer without a key: the same user's create through the same route.
        if (existing.companyId === companyId && existing.createdBy === principal.userId) {
          return { dto: await this.toDto(existing), replayed: true };
        }
        throw new RecordIdTakenError();
      }
    }
    const now = this.deps.clock();
    const id = input.id ?? crypto.randomUUID();
    const row: SyncProbeRow = {
      id,
      companyId,
      createdBy: principal.userId,
      updatedBy: principal.userId,
      title: input.title,
      note: input.note,
      version: 1,
      deviceId: offline?.deviceId ?? null,
      capturedAt: new Date(offline?.capturedAt ?? now),
      receivedAt: new Date(now),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
    const statements: Statement[] = [
      this.db.insert(syncProbe).values(row),
      this.audit.entry({
        action: 'sync_probe.created',
        actorUserId: principal.userId,
        companyId,
        entityType: SYNC_PROBE_TYPE,
        entityId: id,
        newValue: { title: row.title, ...offlineAudit(offline) },
      }),
    ];
    if (claim) {
      statements.push(
        this.keys.record(claim, {
          companyId,
          userId: principal.userId,
          resourceType: SYNC_PROBE_TYPE,
          resourceId: id,
          statusCode: 201,
        }),
      );
    }
    try {
      await new UnitOfWork(this.db).add(...statements).commit();
    } catch (error) {
      const text = String((error as { message?: unknown } | null)?.message ?? error);
      if (text.includes('UNIQUE') && text.includes('dev_sync_probe.id')) throw new RecordIdTakenError();
      throw error;
    }
    return { dto: await this.toDto(row), replayed: false };
  }

  // ---- Update (T-70: versioned) ---------------------------------------------------------

  async snapshot(companyId: string, id: string): Promise<SyncSnapshot | undefined> {
    const row = await this.find(companyId, id);
    if (!row) return undefined;
    return {
      version: row.version,
      values: { title: row.title, note: row.note },
      projectId: null,
      projectCode: null,
      label: label(row),
      changedBy: row.updatedBy,
    };
  }

  /** The update as statements, guarded on the version (also used to resolve conflicts). */
  prepare(
    row: SyncProbeRow,
    principal: Principal,
    values: UpdateValues,
    expectVersion: number,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): PreparedUpdate {
    const now = new Date(this.deps.clock());
    const next = {
      title: values.title ?? row.title,
      note: values.note ?? row.note,
      version: expectVersion + 1,
    };
    const statements: Statement[] = [
      this.db
        .update(syncProbe)
        .set({ ...next, updatedBy: principal.userId, updatedAt: now })
        .where(and(eq(syncProbe.id, row.id), eq(syncProbe.version, expectVersion))),
      // T-58 pattern: fail the batch unless the update above applied.
      this.db
        .select({
          ok: sql<number>`case when ${syncProbe.version} = ${next.version} and ${syncProbe.updatedBy} = ${principal.userId} then 1 else json('probe changed') end`,
        })
        .from(syncProbe)
        .where(eq(syncProbe.id, row.id)),
      this.audit.entry({
        action: 'sync_probe.updated',
        actorUserId: principal.userId,
        companyId: row.companyId,
        entityType: SYNC_PROBE_TYPE,
        entityId: row.id,
        oldValue: { title: row.title, note: row.note, version: row.version },
        newValue: { ...next, ...offlineAudit(offline) },
      }),
    ];
    if (claim) {
      statements.push(
        this.keys.record(claim, {
          companyId: row.companyId,
          userId: principal.userId,
          resourceType: SYNC_PROBE_TYPE,
          resourceId: row.id,
          statusCode: 200,
        }),
      );
    }
    return { statements, record: { ...next, id: row.id } };
  }

  async update(
    companyId: string,
    principal: Principal,
    id: string,
    input: UpdateValues & { baseVersion: number },
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<SyncProbeDto> {
    const row = await this.own(companyId, principal, id);
    const { baseVersion, ...values } = input;
    if (row.version !== baseVersion) throw await this.conflict(companyId, principal, row, baseVersion, values, offline);
    const prepared = this.prepare(row, principal, values, baseVersion, claim, offline);
    try {
      await new UnitOfWork(this.db).add(...prepared.statements).commit();
    } catch (error) {
      if (!isVersionGuardFailure(error)) throw error;
      const latest = await this.own(companyId, principal, id);
      throw await this.conflict(companyId, principal, latest, baseVersion, values, offline);
    }
    return this.get(companyId, principal, id);
  }

  /** Offline (D-20): both versions kept for review. Online: a plain refusal to reload. */
  private async conflict(
    companyId: string,
    principal: Principal,
    current: SyncProbeRow,
    baseVersion: number,
    values: UpdateValues,
    offline: OfflineMeta | null,
  ): Promise<SyncConflictError> {
    if (!offline) return new SyncConflictError(null, current.version);
    const snapshot = await this.snapshot(companyId, current.id);
    if (!snapshot) throw new NotFoundError();
    return new SyncConflictService(this.db, this.deps.meta, this.deps.clock).detect({
      companyId,
      userId: principal.userId,
      entity: syncProbeEntity,
      entityId: current.id,
      baseVersion,
      clientPayload: { ...values },
      snapshot,
    });
  }

  // ---- Photos (T-74) ---------------------------------------------------------------------

  async addPhoto(
    companyId: string,
    principal: Principal,
    id: string,
    file: File,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<SyncProbeDto> {
    const row = await this.own(companyId, principal, id);
    const count = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(syncProbePhoto)
      .where(eq(syncProbePhoto.probeId, row.id))
      .get();
    if ((count?.n ?? 0) >= OFFLINE_LIMITS.photosPerRecord) {
      throw new ValidationError([
        { path: 'file', message: `Up to ${String(OFFLINE_LIMITS.photosPerRecord)} photos.` },
      ]);
    }
    const stored = await this.files.store({
      companyId,
      category: 'sync_probe_photo',
      uploadedBy: principal.userId,
      file,
      beforeWrite: async (sizeBytes) =>
        new PlanLimitService(new SubscriptionService(this.db, this.deps.clock)).assertCanAdd(
          companyId,
          'storage',
          await this.files.usedBytes(companyId),
          sizeBytes,
        ),
    });
    const now = new Date(this.deps.clock());
    const statements: Statement[] = [
      stored.statement,
      this.db.insert(syncProbePhoto).values({
        id: crypto.randomUUID(),
        probeId: row.id,
        companyId,
        fileId: stored.row.id,
        createdAt: now,
      }),
      this.audit.entry({
        action: 'sync_probe.photo_added',
        actorUserId: principal.userId,
        companyId,
        entityType: SYNC_PROBE_TYPE,
        entityId: row.id,
        newValue: { fileId: stored.row.id, ...offlineAudit(offline) },
      }),
    ];
    if (claim) {
      statements.push(
        this.keys.record(claim, {
          companyId,
          userId: principal.userId,
          resourceType: SYNC_PROBE_TYPE,
          resourceId: row.id,
          statusCode: 201,
        }),
      );
    }
    await new UnitOfWork(this.db).add(...statements).commit();
    return this.get(companyId, principal, id);
  }

  async openPhoto(
    companyId: string,
    principal: Principal,
    id: string,
    fileId: string,
  ): Promise<OpenedFile | null> {
    const row = await this.own(companyId, principal, id);
    const link = await this.db
      .select()
      .from(syncProbePhoto)
      .where(and(eq(syncProbePhoto.probeId, row.id), eq(syncProbePhoto.fileId, fileId)))
      .get();
    if (!link) return null;
    return this.files.open(fileId, companyId);
  }
}

/** T-72 / T-70: the probe as a sync entity, so its conflicts can be resolved. */
export const syncProbeEntity: SyncEntity = {
  type: SYNC_PROBE_TYPE,
  conflictFields: SYNC_PROBE_CONFLICT_FIELDS,
  async snapshot(db, companyId, entityId) {
    await ensureProbeTables(db);
    const row = await db
      .select()
      .from(syncProbe)
      .where(and(eq(syncProbe.companyId, companyId), eq(syncProbe.id, entityId)))
      .get();
    if (!row) return undefined;
    return {
      version: row.version,
      values: { title: row.title, note: row.note },
      projectId: null,
      projectCode: null,
      label: label(row),
      changedBy: row.updatedBy,
    };
  },
  async prepareUpdate(input: PrepareUpdateInput) {
    const row = await input.db
      .select()
      .from(syncProbe)
      .where(and(eq(syncProbe.companyId, input.companyId), eq(syncProbe.id, input.entityId)))
      .get();
    if (!row) throw new NotFoundError();
    if (row.createdBy !== input.principal.userId) throw new ForbiddenError();
    const parsed = updateSyncProbeRequestSchema
      .omit({ baseVersion: true })
      .safeParse(input.values);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }
    const service = new SyncProbeService({
      db: input.db,
      meta: input.meta,
      clock: () => input.now,
    });
    return service.prepare(row, input.principal, parsed.data, input.expectVersion, undefined, input.offline);
  },
};
