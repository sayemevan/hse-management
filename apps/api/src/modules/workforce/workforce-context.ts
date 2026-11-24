import {
  type ActivityAction,
  type ActivityChanges,
  type ActivitySnapshot,
  zonedIsoDate,
} from '@hse/shared';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { ActivityService } from '../../platform/activity';
import { type AuditAction, AuditLogService } from '../../platform/audit-log';
import { FileStorageService } from '../../platform/file-storage';
import { NotificationService } from '../../platform/notification';
import type { PermissionResolver } from '../identity';
import { PlanLimitService, SubscriptionService } from '../subscription';
import { WorkforceListService } from './list.service';
import { WorkforceRepository } from './workforce.repository';
import type { WorkforceMemberRow } from './workforce.schema';

export interface WorkforceDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  bucket: R2Bucket;
  resolver: PermissionResolver;
}

/** Shared services of one workforce request: repository, lists, audit, timeline, files. */
export class WorkforceContext {
  readonly repo: WorkforceRepository;
  readonly lists: WorkforceListService;
  readonly audit: AuditLogService;
  readonly activity: ActivityService;
  readonly notifications: NotificationService;
  readonly files: FileStorageService;

  constructor(readonly deps: WorkforceDeps) {
    this.repo = new WorkforceRepository(deps.db);
    this.lists = new WorkforceListService(deps);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.activity = new ActivityService(deps.db, deps.clock);
    this.notifications = new NotificationService(deps.db, deps.clock);
    this.files = new FileStorageService(deps.db, deps.bucket, deps.clock);
  }

  get db(): Database {
    return this.deps.db;
  }

  now(): number {
    return this.deps.clock();
  }

  /** T-50: the calendar day in the company's time zone. */
  today(tenant: TenantCompany): string {
    return zonedIsoDate(this.deps.clock(), tenant.timeZone);
  }

  /** PLT-12 FR-5: the plan's storage, checked before a workforce file is written. */
  storageCheck(companyId: string): (sizeBytes: number) => Promise<void> {
    return async (sizeBytes) =>
      new PlanLimitService(new SubscriptionService(this.deps.db, this.deps.clock)).assertCanAdd(
        companyId,
        'storage',
        await this.files.usedBytes(companyId),
        sizeBytes,
      );
  }

  /** The audit entry and the profile History entry of one change (T-56). */
  record(
    principal: Principal,
    member: WorkforceMemberRow,
    details: {
      audit: AuditAction;
      activity?: ActivityAction;
      entityType?: string;
      entityId?: string;
      projectId?: string | null;
      oldValue?: Record<string, unknown> | null;
      newValue?: Record<string, unknown> | null;
      changes?: ActivityChanges | null;
      snapshot?: ActivitySnapshot;
    },
  ): Statement[] {
    const statements: Statement[] = [
      this.audit.entry({
        action: details.audit,
        actorUserId: principal.userId,
        companyId: member.companyId,
        projectId: details.projectId ?? null,
        entityType: details.entityType ?? 'workforce_member',
        entityId: details.entityId ?? member.id,
        oldValue: details.oldValue ?? null,
        newValue: details.newValue ?? null,
      }),
    ];
    if (details.activity) {
      statements.push(
        this.activity.entry({
          action: details.activity,
          companyId: member.companyId,
          projectId: details.projectId ?? null,
          entityType: 'workforce_member',
          entityId: member.id,
          actorUserId: principal.userId,
          changes: details.changes ?? null,
          snapshot: { memberName: member.fullName, ...(details.snapshot ?? {}) },
        }),
      );
    }
    return statements;
  }
}
