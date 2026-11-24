import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';

/**
 * Immutable activity timeline (PLT-18, T-43). Like `audit_log`, a documented exception to the
 * audit columns: rows are never updated or deleted (database triggers, migration 0009).
 */
export const activityEntry = sqliteTable(
  'activity_entry',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    projectId: text('project_id'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    actorUserId: text('actor_user_id'),
    changes: text('changes'),
    snapshot: text('snapshot'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('activity_entry_project_idx').on(table.projectId, table.occurredAt),
    index('activity_entry_entity_idx').on(table.entityType, table.entityId, table.occurredAt),
  ],
);

export type ActivityEntryRow = typeof activityEntry.$inferSelect;
