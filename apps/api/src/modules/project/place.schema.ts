import { PLACE_LEVELS } from '@hse/shared';
import { type AnySQLiteColumn, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { auditColumns, primaryKey } from '../../database/columns';
import { project } from './project.schema';

/**
 * Areas, Locations and Work Zones (US-019 – US-021, T-38). Names and codes are unique among
 * siblings; the service checks it (SQLite treats NULL parents as distinct in a unique index).
 * Deleted only when unused (T-39); otherwise deactivated.
 */
export const place = sqliteTable(
  'place',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id),
    level: text('level', { enum: PLACE_LEVELS }).notNull(),
    parentId: text('parent_id').references((): AnySQLiteColumn => place.id),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    code: text('code'),
    description: text('description'),
    position: integer('position').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    deactivatedAt: integer('deactivated_at', { mode: 'timestamp_ms' }),
    deactivatedBy: text('deactivated_by'),
    ...auditColumns(),
  },
  (table) => [
    index('place_project_parent_idx').on(table.projectId, table.parentId, table.position),
    index('place_project_level_idx').on(table.projectId, table.level, table.active),
  ],
);

export type PlaceRow = typeof place.$inferSelect;
