import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { Database } from '../../database/client';

/**
 * O-116: the sync probe exists only in development and test builds. Its tables are **not** in
 * the migrations (this file is outside drizzle-kit's `*.schema.ts` glob): the probe creates them
 * on first use, so a production database never has them.
 */
export const syncProbe = sqliteTable(
  'dev_sync_probe',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    title: text('title').notNull(),
    note: text('note').notNull(),
    version: integer('version').notNull(),
    deviceId: text('device_id'),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull(),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('dev_sync_probe_owner_idx').on(table.companyId, table.createdBy)],
);

export const syncProbePhoto = sqliteTable(
  'dev_sync_probe_photo',
  {
    id: text('id').primaryKey(),
    probeId: text('probe_id').notNull(),
    companyId: text('company_id').notNull(),
    fileId: text('file_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('dev_sync_probe_photo_probe_idx').on(table.probeId, table.createdAt)],
);

export type SyncProbeRow = typeof syncProbe.$inferSelect;

const DDL = [
  `CREATE TABLE IF NOT EXISTS dev_sync_probe (
    id text PRIMARY KEY NOT NULL, company_id text NOT NULL, created_by text NOT NULL,
    updated_by text NOT NULL, title text NOT NULL, note text NOT NULL, version integer NOT NULL,
    device_id text, captured_at integer NOT NULL, received_at integer NOT NULL,
    created_at integer NOT NULL, updated_at integer NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS dev_sync_probe_owner_idx ON dev_sync_probe (company_id, created_by)',
  `CREATE TABLE IF NOT EXISTS dev_sync_probe_photo (
    id text PRIMARY KEY NOT NULL, probe_id text NOT NULL, company_id text NOT NULL,
    file_id text NOT NULL, created_at integer NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS dev_sync_probe_photo_probe_idx ON dev_sync_probe_photo (probe_id, created_at)',
];

/**
 * Creates the probe tables if they are missing (development and test only). Run on every probe
 * request: four `IF NOT EXISTS` statements are cheap, and a test database may be new.
 */
export async function ensureProbeTables(db: Database): Promise<void> {
  for (const statement of DDL) await db.run(sql.raw(statement));
}
