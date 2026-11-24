import { LANGUAGES } from '@hse/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';

export const EMAIL_STATUSES = ['queued', 'sent', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Every email requested by any module (PLT-05). Never holds passwords or raw tokens. */
export const emailOutbox = sqliteTable(
  'email_outbox',
  {
    ...primaryKey(),
    template: text('template').notNull(),
    recipient: text('recipient').notNull(),
    language: text('language', { enum: LANGUAGES }).notNull(),
    data: text('data').notNull(),
    // True when the email carries a secret link that is only in the queue message.
    hasSecrets: integer('has_secrets', { mode: 'boolean' }).notNull(),
    status: text('status', { enum: EMAIL_STATUSES }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    lastError: text('last_error'),
    companyId: text('company_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('email_outbox_status_created_idx').on(table.status, table.createdAt)],
);

export type EmailOutboxRow = typeof emailOutbox.$inferSelect;
