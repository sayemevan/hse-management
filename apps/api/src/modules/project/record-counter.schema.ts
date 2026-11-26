import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { project } from './project.schema';

/**
 * Per-project number sequences (T-60). One row per project and kind (`action`, later
 * `inspection`, `permit`, …). `next_value` is the number the next record gets.
 */
export const recordCounter = sqliteTable(
  'record_counter',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id),
    kind: text('kind').notNull(),
    nextValue: integer('next_value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.kind] })],
);

export type RecordCounterRow = typeof recordCounter.$inferSelect;
