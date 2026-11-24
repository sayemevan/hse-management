import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { auditColumns, primaryKey, softDeleteColumns } from '../../database/columns';

/**
 * Metadata for every stored file (PLT-07). The bytes live in R2 under `storage_key`.
 * `company_id` is null only for platform files. No foreign key to `company`, so the
 * platform layer stays independent of business modules.
 */
export const file = sqliteTable(
  'file',
  {
    ...primaryKey(),
    companyId: text('company_id'),
    category: text('category').notNull(),
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksum: text('checksum').notNull(),
    ...auditColumns(),
    ...softDeleteColumns(),
  },
  (table) => [
    uniqueIndex('file_storage_key_unique').on(table.storageKey),
    index('file_company_category_idx').on(table.companyId, table.category),
  ],
);

export type FileRow = typeof file.$inferSelect;
