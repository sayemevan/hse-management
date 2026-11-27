import {
  type ActivityAction,
  type ActivityChanges,
  type ActivitySnapshot,
  inspectionReference,
  type NotificationParams,
  type NotificationType,
  zonedIsoDate,
} from '@hse/shared';

import type { TenantCompany } from '../../core/context/tenant';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { ActivityService } from '../../platform/activity';
import { type AuditAction, AuditLogService } from '../../platform/audit-log';
import { CommentService } from '../../platform/comment';
import { FileStorageService } from '../../platform/file-storage';
import { NotificationService } from '../../platform/notification';
import { IdempotencyService } from '../../platform/sync';
import { type PermissionResolver, ProjectAudience } from '../identity';
import { PlaceDirectory, RecordNumbers } from '../project';
import { PlanLimitService, SubscriptionService } from '../subscription';
import type { InspectionRow, InspectionTemplateRow } from './inspection.schema';

export interface InspectionDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  /** Only needed for files and actions. */
  bucket?: R2Bucket;
  resolver: PermissionResolver;
}

/** The project of an inspection, as loaded by the caller. */
export interface InspectionProject {
  id: string;
  code: string;
  status: string;
}

/** Shared services of one inspection request (the ActionContext pattern). */
export class InspectionContext {
  readonly audit: AuditLogService;
  readonly activity: ActivityService;
  readonly notifications: NotificationService;
  readonly comments: CommentService;
  readonly places: PlaceDirectory;
  readonly numbers: RecordNumbers;
  readonly audience: ProjectAudience;
  readonly keys: IdempotencyService;

  constructor(readonly deps: InspectionDeps) {
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.activity = new ActivityService(deps.db, deps.clock);
    this.notifications = new NotificationService(deps.db, deps.clock);
    this.comments = new CommentService(deps.db, this.audit, deps.clock);
    this.places = new PlaceDirectory(deps.db);
    this.numbers = new RecordNumbers(deps.db);
    this.audience = new ProjectAudience(deps.db, deps.clock);
    this.keys = new IdempotencyService(deps.db, deps.clock);
  }

  get db(): Database {
    return this.deps.db;
  }

  get resolver(): PermissionResolver {
    return this.deps.resolver;
  }

  get files(): FileStorageService {
    if (!this.deps.bucket) throw new Error('File storage is not available here');
    return new FileStorageService(this.deps.db, this.deps.bucket, this.deps.clock);
  }

  now(): number {
    return this.deps.clock();
  }

  today(tenant: Pick<TenantCompany, 'timeZone'>): string {
    return zonedIsoDate(this.deps.clock(), tenant.timeZone);
  }

  storageCheck(companyId: string): (sizeBytes: number) => Promise<void> {
    return async (sizeBytes) =>
      new PlanLimitService(new SubscriptionService(this.deps.db, this.deps.clock)).assertCanAdd(
        companyId,
        'storage',
        await this.files.usedBytes(companyId),
        sizeBytes,
      );
  }

  async projectPermissions(userId: string, companyId: string, projectId: string): Promise<Set<string>> {
    return this.resolver.projectPermissions(userId, companyId, projectId);
  }

  /** T-41: only recipients who can still view the project. */
  async withAccess(companyId: string, projectId: string, userIds: Iterable<string>): Promise<string[]> {
    const result: string[] = [];
    for (const userId of new Set(userIds)) {
      if ((await this.projectPermissions(userId, companyId, projectId)).has('projects.view')) {
        result.push(userId);
      }
    }
    return result;
  }

  params(row: InspectionRow, project: InspectionProject, template: InspectionTemplateRow | null): NotificationParams {
    return {
      projectCode: project.code,
      inspectionReference: inspectionReference(project.code, row.number),
      templateNameEn: template?.nameEn ?? null,
      templateNameAr: template?.nameAr ?? null,
      plannedOn: row.plannedOn,
    };
  }

  async notify(
    type: NotificationType,
    row: InspectionRow,
    project: InspectionProject,
    template: InspectionTemplateRow | null,
    actorUserId: string | null,
    recipients: Iterable<string>,
    extra: NotificationParams = {},
  ): Promise<Statement[]> {
    const allowed = await this.withAccess(row.companyId, row.projectId, recipients);
    if (allowed.length === 0) return [];
    return this.notifications.entries({
      type,
      companyId: row.companyId,
      projectId: row.projectId,
      entityType: 'inspection',
      entityId: row.id,
      actorUserId,
      params: { ...this.params(row, project, template), ...extra },
      recipients: allowed,
    });
  }

  /** The audit entry and the timeline entry (project timeline and the inspection's History). */
  record(
    actorUserId: string | null,
    row: InspectionRow,
    project: InspectionProject,
    template: InspectionTemplateRow | null,
    details: {
      audit: AuditAction;
      activity?: ActivityAction;
      oldValue?: Record<string, unknown> | null;
      newValue?: Record<string, unknown> | null;
      changes?: ActivityChanges | null;
      snapshot?: ActivitySnapshot;
      at?: number;
    },
  ): Statement[] {
    const statements: Statement[] = [
      this.audit.entry({
        action: details.audit,
        actorUserId,
        companyId: row.companyId,
        projectId: row.projectId,
        entityType: 'inspection',
        entityId: row.id,
        oldValue: details.oldValue ?? null,
        newValue: details.newValue ?? null,
      }),
    ];
    if (details.activity) {
      statements.push(
        this.activity.entry({
          action: details.activity,
          companyId: row.companyId,
          projectId: row.projectId,
          entityType: 'inspection',
          entityId: row.id,
          actorUserId,
          changes: details.changes ?? null,
          snapshot: {
            projectCode: project.code,
            inspectionReference: inspectionReference(project.code, row.number),
            templateNameEn: template?.nameEn ?? null,
            templateNameAr: template?.nameAr ?? null,
            ...(details.snapshot ?? {}),
          },
          ...(details.at === undefined ? {} : { occurredAt: details.at }),
        }),
      );
    }
    return statements;
  }
}
