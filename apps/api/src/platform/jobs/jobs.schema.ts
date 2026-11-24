import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';

export const JOB_OUTCOMES = ['succeeded', 'failed'] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

/**
 * One row per scheduled job run (PLT-09 FR-3, T-25). Written once by the system, never
 * edited, so it has no audit columns.
 */
export const jobRun = sqliteTable(
  'job_run',
  {
    ...primaryKey(),
    jobName: text('job_name').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }).notNull(),
    outcome: text('outcome', { enum: JOB_OUTCOMES }).notNull(),
    processed: integer('processed').notNull(),
    changed: integer('changed').notNull(),
    failed: integer('failed').notNull(),
    error: text('error'),
  },
  (table) => [index('job_run_name_started_idx').on(table.jobName, table.startedAt)],
);

/** Reminders already sent, one row per unique key (PLT-09 FR-5, T-26). */
export const reminderLog = sqliteTable(
  'reminder_log',
  {
    ...primaryKey(),
    key: text('key').notNull(),
    companyId: text('company_id'),
    template: text('template').notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('reminder_log_key_unique').on(table.key),
    index('reminder_log_company_idx').on(table.companyId),
  ],
);

export type JobRunRow = typeof jobRun.$inferSelect;
