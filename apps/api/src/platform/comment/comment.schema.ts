import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';

/**
 * Comments for every module (PLT-22, T-63). Never deleted (O-110: a database trigger refuses
 * DELETE, migration 0013); the author may edit within 15 minutes, the old text goes to the audit
 * log.
 */
export const comment = sqliteTable(
  'comment',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    projectId: text('project_id'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('comment_entity_idx').on(table.entityType, table.entityId, table.createdAt, table.id),
    index('comment_author_idx').on(table.authorId, table.createdAt),
  ],
);

export type CommentRow = typeof comment.$inferSelect;
