import { generateId } from '@hse/shared';

import { redact } from '../../core/security/redaction';
import type { Database } from '../../database/client';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { type AuditAction, isAuditAction } from './audit-actions';
import { auditLog } from './audit-log.schema';

/** Maximum stored size of `old_value` / `new_value` (PLT-01 validation rules). */
export const AUDIT_VALUE_MAX_BYTES = 32 * 1024;

/** Request facts recorded with every audit entry. */
export interface AuditRequestContext {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEvent {
  action: AuditAction;
  /** `null` means the system acted (no user). */
  actorUserId: string | null;
  companyId?: string | null;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: 'success' | 'failure';
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

/**
 * The single audit service for every module (Master Rules §9).
 *
 * Use `entry()` to get a statement and commit it in the same `UnitOfWork` as the business
 * change it describes. Use `record()` only when there is no business change (for example,
 * a failed login for an unknown email). There is deliberately no update or delete.
 */
export class AuditLogService {
  constructor(
    private readonly db: Database,
    private readonly request: AuditRequestContext,
    private readonly clock: () => number = Date.now,
  ) {}

  entry(event: AuditEvent): Statement {
    if (!isAuditAction(event.action)) {
      throw new Error(`Unknown audit action: ${String(event.action)}`);
    }
    return this.db.insert(auditLog).values({
      id: generateId(),
      occurredAt: new Date(this.clock()),
      actorUserId: event.actorUserId,
      companyId: event.companyId ?? null,
      projectId: event.projectId ?? null,
      action: event.action,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      outcome: event.outcome ?? 'success',
      oldValue: serializeValue(event.oldValue),
      newValue: serializeValue(event.newValue),
      requestId: this.request.requestId ?? null,
      ipAddress: this.request.ipAddress ?? null,
      userAgent: this.request.userAgent ?? null,
    });
  }

  async record(event: AuditEvent): Promise<void> {
    await new UnitOfWork(this.db).add(this.entry(event)).commit();
  }
}

/** Redacts secrets and truncates oversized values with a marker. */
export function serializeValue(value: Record<string, unknown> | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const json = JSON.stringify(redact(value));
  if (new TextEncoder().encode(json).byteLength <= AUDIT_VALUE_MAX_BYTES) return json;

  const previewLength = AUDIT_VALUE_MAX_BYTES / 2;
  return JSON.stringify({ _truncated: true, preview: json.slice(0, previewLength) });
}
