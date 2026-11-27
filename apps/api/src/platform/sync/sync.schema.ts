import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';

/**
 * PLT-29 (T-69): one row per accepted idempotent write, committed in the same batch as the
 * change. A repeat of the key replays the result; keys expire after 30 days (O-124).
 */
export const idempotencyKey = sqliteTable(
  'idempotency_key',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    method: text('method').notNull(),
    route: text('route').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_key_company_key_idx').on(table.companyId, table.key),
    index('idempotency_key_expires_idx').on(table.expiresAt),
  ],
);

export type IdempotencyKeyRow = typeof idempotencyKey.$inferSelect;

/**
 * PLT-30 (T-70, D-20): both versions of every offline conflict and its resolution. Kept
 * permanently (O-124); a trigger makes rows read-only once they leave `open` (migration 0015).
 */
export const syncConflict = sqliteTable(
  'sync_conflict',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    projectId: text('project_id'),
    userId: text('user_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    label: text('label').notNull(),
    projectCode: text('project_code'),
    baseVersion: integer('base_version').notNull(),
    serverVersion: integer('server_version').notNull(),
    changedBy: text('changed_by'),
    clientPayload: text('client_payload').notNull(),
    serverSnapshot: text('server_snapshot').notNull(),
    status: text('status', { enum: ['open', 'resolved', 'discarded', 'superseded'] }).notNull(),
    resolution: text('resolution', { enum: ['mine', 'theirs', 'combine'] }),
    resolvedValues: text('resolved_values'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('sync_conflict_user_idx').on(table.companyId, table.userId, table.status, table.createdAt),
    index('sync_conflict_entity_idx').on(table.entityType, table.entityId),
    index('sync_conflict_open_idx').on(table.status, table.createdAt),
  ],
);

export type SyncConflictRow = typeof syncConflict.$inferSelect;
