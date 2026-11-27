import {
  type ActivityAction,
  type ActivityChanges,
  type ActivitySnapshot,
  type NotificationParams,
  type NotificationType,
  safetyEventReference,
  zonedIsoDate,
} from "@hse/shared";

import type { TenantCompany } from "../../core/context/tenant";
import type { RequestMeta } from "../../core/http/request-meta";
import type { Database } from "../../database/client";
import type { Statement } from "../../database/unit-of-work";
import { ActivityService } from "../../platform/activity";
import { type AuditAction, AuditLogService } from "../../platform/audit-log";
import { CommentService } from "../../platform/comment";
import { FileStorageService } from "../../platform/file-storage";
import { NotificationService } from "../../platform/notification";
import { IdempotencyService } from "../../platform/sync";
import { type PermissionResolver, ProjectAudience } from "../identity";
import { PlaceDirectory, RecordNumbers } from "../project";
import { PlanLimitService, SubscriptionService } from "../subscription";
import type { SafetyEventRow, SafetyEventTypeRow } from "./safety-event.schema";

export interface SafetyEventDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  /** Only needed for files and actions. */
  bucket?: R2Bucket;
  resolver: PermissionResolver;
}

/** The project of an event, as loaded by the caller. */
export interface SafetyEventProject {
  id: string;
  code: string;
  status: string;
}

/** Shared services of one safety event request (the InspectionContext pattern). */
export class SafetyEventContext {
  readonly audit: AuditLogService;
  readonly activity: ActivityService;
  readonly notifications: NotificationService;
  readonly comments: CommentService;
  readonly places: PlaceDirectory;
  readonly numbers: RecordNumbers;
  readonly audience: ProjectAudience;
  readonly keys: IdempotencyService;

  constructor(readonly deps: SafetyEventDeps) {
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
    if (!this.deps.bucket)
      throw new Error("File storage is not available here");
    return new FileStorageService(
      this.deps.db,
      this.deps.bucket,
      this.deps.clock,
    );
  }

  now(): number {
    return this.deps.clock();
  }

  today(tenant: Pick<TenantCompany, "timeZone">): string {
    return zonedIsoDate(this.deps.clock(), tenant.timeZone);
  }

  storageCheck(companyId: string): (sizeBytes: number) => Promise<void> {
    return async (sizeBytes) =>
      new PlanLimitService(
        new SubscriptionService(this.deps.db, this.deps.clock),
      ).assertCanAdd(
        companyId,
        "storage",
        await this.files.usedBytes(companyId),
        sizeBytes,
      );
  }

  async projectPermissions(
    userId: string,
    companyId: string,
    projectId: string,
  ): Promise<Set<string>> {
    return this.resolver.projectPermissions(userId, companyId, projectId);
  }

  params(
    row: SafetyEventRow,
    project: SafetyEventProject,
    type: SafetyEventTypeRow | null,
  ): NotificationParams {
    return {
      projectCode: project.code,
      eventReference: safetyEventReference(project.code, row.number),
      typeNameEn: type?.nameEn ?? null,
      typeNameAr: type?.nameAr ?? null,
      eventTitle: row.title.slice(0, 80),
      severity: row.severity ?? row.reportedSeverity,
    };
  }

  /**
   * T-41, T-93: only recipients who can still see the event (reporter, team or a viewer).
   * `allowed` decides per user; the default is "can view all events of the project".
   */
  async notify(
    type: NotificationType,
    row: SafetyEventRow,
    project: SafetyEventProject,
    eventType: SafetyEventTypeRow | null,
    actorUserId: string | null,
    recipients: Iterable<string>,
    canSee: (userId: string) => Promise<boolean>,
    extra: NotificationParams = {},
  ): Promise<Statement[]> {
    const allowed: string[] = [];
    for (const userId of new Set(recipients)) {
      if (userId === actorUserId) continue;
      if (await canSee(userId)) allowed.push(userId);
    }
    if (allowed.length === 0) return [];
    return this.notifications.entries({
      type,
      companyId: row.companyId,
      projectId: row.projectId,
      entityType: "safety_event",
      entityId: row.id,
      actorUserId,
      params: { ...this.params(row, project, eventType), ...extra },
      recipients: allowed,
    });
  }

  /**
   * The audit entry and the timeline entry (project timeline and the event's History). Entries
   * about people and sensitive files are kept off the project timeline (`projectId` null) and
   * marked `sensitive` for the event's History (T-92).
   */
  record(
    actorUserId: string | null,
    row: SafetyEventRow,
    project: SafetyEventProject,
    eventType: SafetyEventTypeRow | null,
    details: {
      audit: AuditAction;
      activity?: ActivityAction;
      oldValue?: Record<string, unknown> | null;
      newValue?: Record<string, unknown> | null;
      changes?: ActivityChanges | null;
      snapshot?: ActivitySnapshot;
      sensitive?: boolean;
      at?: number;
    },
  ): Statement[] {
    const statements: Statement[] = [
      this.audit.entry({
        action: details.audit,
        actorUserId,
        companyId: row.companyId,
        projectId: row.projectId,
        entityType: "safety_event",
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
          projectId: details.sensitive ? null : row.projectId,
          entityType: "safety_event",
          entityId: row.id,
          actorUserId,
          changes: details.changes ?? null,
          snapshot: {
            projectCode: project.code,
            eventReference: safetyEventReference(project.code, row.number),
            typeNameEn: eventType?.nameEn ?? null,
            typeNameAr: eventType?.nameAr ?? null,
            ...(details.sensitive ? { sensitive: true } : {}),
            ...(details.snapshot ?? {}),
          },
          ...(details.at === undefined ? {} : { occurredAt: details.at }),
        }),
      );
    }
    return statements;
  }
}
