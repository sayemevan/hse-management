import { generateId } from '@hse/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Immutable audit log (PLT-01). The documented exception to the standard audit columns:
 * rows are never updated or deleted, so there are no `updated_*` / `deleted_*` columns.
 * Database triggers (migration `0001_audit_log_immutable`) reject UPDATE and DELETE.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => generateId()),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    actorUserId: text('actor_user_id'),
    companyId: text('company_id'),
    projectId: text('project_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('audit_log_occurred_at_idx').on(table.occurredAt),
    index('audit_log_company_occurred_idx').on(table.companyId, table.occurredAt),
    index('audit_log_action_idx').on(table.action),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
  ],
);
