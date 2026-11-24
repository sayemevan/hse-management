import { PROJECT_STATUSES } from '@hse/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { auditColumns, primaryKey } from '../../database/columns';
import { company } from '../company';

/**
 * `project` (US-016 – US-018). Projects are never deleted (Doc 06 §13); archiving is a
 * status. Dates are calendar days `YYYY-MM-DD` without a time zone (T-36).
 */
export const project = sqliteTable(
  'project',
  {
    ...primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    /** Upper case; unique in the company, archived projects included (O-51). */
    code: text('code').notNull(),
    name: text('name').notNull(),
    clientName: text('client_name').notNull(),
    contractNumber: text('contract_number'),
    description: text('description'),
    city: text('city'),
    countryCode: text('country_code').notNull(),
    startDate: text('start_date').notNull(),
    expectedEndDate: text('expected_end_date'),
    status: text('status', { enum: PROJECT_STATUSES }).notNull(),
    statusBeforeHold: text('status_before_hold', { enum: PROJECT_STATUSES }),
    statusBeforeArchive: text('status_before_archive', { enum: PROJECT_STATUSES }),
    statusChangedAt: integer('status_changed_at', { mode: 'timestamp_ms' }).notNull(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    archivedBy: text('archived_by'),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('project_company_code_unique').on(table.companyId, table.code),
    index('project_company_status_idx').on(table.companyId, table.status),
    index('project_company_name_idx').on(table.companyId, table.name),
  ],
);

export type ProjectRow = typeof project.$inferSelect;
