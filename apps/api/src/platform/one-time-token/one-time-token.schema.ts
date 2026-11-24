import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';

/** Purposes for single-use links (T-10, T-16). */
export const TOKEN_PURPOSES = [
  'registration_email',
  'registration_resubmit',
  'invitation',
  'password_reset',
] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

/** Single-use, expiring tokens. Only the SHA-256 hash is stored. */
export const oneTimeToken = sqliteTable(
  'one_time_token',
  {
    ...primaryKey(),
    purpose: text('purpose', { enum: TOKEN_PURPOSES }).notNull(),
    subjectId: text('subject_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('one_time_token_hash_unique').on(table.tokenHash),
    index('one_time_token_subject_idx').on(table.purpose, table.subjectId),
  ],
);

export type OneTimeTokenRow = typeof oneTimeToken.$inferSelect;
