import { NOTIFICATION_TYPES } from '@hse/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';

/**
 * One row per recipient (PLT-17, T-40). A delivery record, not a business record: it has
 * `created_at` and `read_at` only, and is removed after one year (O-63).
 */
export const notification = sqliteTable(
  'notification',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    recipientUserId: text('recipient_user_id').notNull(),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    params: text('params').notNull(),
    actorUserId: text('actor_user_id'),
    projectId: text('project_id'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('notification_recipient_created_idx').on(table.recipientUserId, table.createdAt),
    index('notification_recipient_unread_idx').on(table.recipientUserId, table.readAt),
    index('notification_created_idx').on(table.createdAt),
  ],
);

export type NotificationRow = typeof notification.$inferSelect;
