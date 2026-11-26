import {
  type ActivityAction,
  type ActivityChanges,
  type ActivitySnapshot,
  actionReference,
  zonedIsoDate,
} from '@hse/shared';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { ActivityService } from '../../platform/activity';
import { type AuditAction, AuditLogService } from '../../platform/audit-log';
import { CommentService } from '../../platform/comment';
import { FileStorageService } from '../../platform/file-storage';
import { NotificationService } from '../../platform/notification';
import { type PermissionResolver, ProjectAudience } from '../identity';
import { PlaceDirectory, RecordNumbers } from '../project';
import { PlanLimitService, SubscriptionService } from '../subscription';
import { ActionRepository } from './action.repository';
import type { ActionRow } from './action.schema';

export interface ActionDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  bucket: R2Bucket;
  resolver: PermissionResolver;
}

/** Shared services of one action request: repository, audit, timeline, notifications, files. */
export class ActionContext {
  readonly repo: ActionRepository;
  readonly audit: AuditLogService;
  readonly activity: ActivityService;
  readonly notifications: NotificationService;
  readonly files: FileStorageService;
  readonly comments: CommentService;
  readonly places: PlaceDirectory;
  readonly numbers: RecordNumbers;
  readonly audience: ProjectAudience;

  constructor(readonly deps: ActionDeps) {
    this.repo = new ActionRepository(deps.db);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.activity = new ActivityService(deps.db, deps.clock);
    this.notifications = new NotificationService(deps.db, deps.clock);
    this.files = new FileStorageService(deps.db, deps.bucket, deps.clock);
    this.comments = new CommentService(deps.db, this.audit, deps.clock);
    this.places = new PlaceDirectory(deps.db);
    this.numbers = new RecordNumbers(deps.db);
    this.audience = new ProjectAudience(deps.db, deps.clock);
  }

  get db(): Database {
    return this.deps.db;
  }

  get resolver(): PermissionResolver {
    return this.deps.resolver;
  }

  now(): number {
    return this.deps.clock();
  }

  /** T-59: the calendar day in the company's time zone. */
  today(tenant: TenantCompany): string {
    return zonedIsoDate(this.deps.clock(), tenant.timeZone);
  }

  /** PLT-12 FR-5: the plan's storage, checked before an evidence file is written. */
  storageCheck(companyId: string): (sizeBytes: number) => Promise<void> {
    return async (sizeBytes) =>
      new PlanLimitService(new SubscriptionService(this.deps.db, this.deps.clock)).assertCanAdd(
        companyId,
        'storage',
        await this.files.usedBytes(companyId),
        sizeBytes,
      );
  }

  /** O-101: may this user own or collaborate on actions of the project now? */
  async eligible(companyId: string, projectId: string, userId: string): Promise<boolean> {
    return (await this.resolver.projectPermissions(userId, companyId, projectId)).has(
      'projects.view',
    );
  }

  /** T-41: only recipients who can still view the project. */
  async withAccess(
    companyId: string,
    projectId: string,
    userIds: Iterable<string>,
  ): Promise<string[]> {
    const result: string[] = [];
    for (const userId of new Set(userIds)) {
      if (await this.eligible(companyId, projectId, userId)) result.push(userId);
    }
    return result;
  }

  /** The audit entry and the timeline entry (project timeline and the action's History). */
  record(
    actorUserId: string | null,
    row: ActionRow,
    projectCode: string,
    details: {
      audit: AuditAction;
      activity?: ActivityAction;
      oldValue?: Record<string, unknown> | null;
      newValue?: Record<string, unknown> | null;
      changes?: ActivityChanges | null;
      snapshot?: ActivitySnapshot;
      /** Order of several entries written by one change. */
      at?: number;
    },
  ): Statement[] {
    const reference = actionReference(projectCode, row.number);
    const statements: Statement[] = [
      this.audit.entry({
        action: details.audit,
        actorUserId,
        companyId: row.companyId,
        projectId: row.projectId,
        entityType: 'action',
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
          entityType: 'action',
          entityId: row.id,
          actorUserId,
          changes: details.changes ?? null,
          snapshot: {
            projectCode,
            actionReference: reference,
            actionTitle: row.title.slice(0, 80),
            ...(details.snapshot ?? {}),
          },
          ...(details.at === undefined ? {} : { occurredAt: details.at }),
        }),
      );
    }
    return statements;
  }
}

export function principalId(principal: Principal): string {
  return principal.userId;
}
