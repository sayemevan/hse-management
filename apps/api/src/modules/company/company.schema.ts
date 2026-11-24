import { LANGUAGES } from '@hse/shared';
import { DATE_FORMATS, TIME_FORMATS } from '@hse/shared';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { auditColumns, primaryKey } from '../../database/columns';

export const COMPANY_STATUSES = [
  'pending_verification',
  'active',
  'read_only',
  'suspended',
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/**
 * Tenant record (PLT-02). Created when a registration is approved (US-011.3); the
 * application itself lives in the registration module. `slug` is lowercase and unique.
 */
export const company = sqliteTable(
  'company',
  {
    ...primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status', { enum: COMPANY_STATUSES }).notNull(),
    defaultLanguage: text('default_language', { enum: LANGUAGES }).notNull(),
    timeZone: text('time_zone').notNull(),
    // Sprint 2 (Doc 08 §3). Nullable so that rows created before Sprint 2 stay valid.
    countryCode: text('country_code'),
    city: text('city'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    // Sprint 3 (US-012).
    registrationNumber: text('registration_number'),
    address: text('address'),
    // Points to `file.id` (PLT-07). No database foreign key: SQLite can only add one by
    // rebuilding the table, and the file service already checks the company on every read.
    logoFileId: text('logo_file_id'),
    ...auditColumns(),
  },
  (table) => [uniqueIndex('company_slug_unique').on(table.slug)],
);

/** Company preferences (US-013, O-28). One row per company; the language stays on `company`. */
export const companySettings = sqliteTable('company_settings', {
  companyId: text('company_id')
    .primaryKey()
    .references(() => company.id),
  dateFormat: text('date_format', { enum: DATE_FORMATS }).notNull().default('DD/MM/YYYY'),
  timeFormat: text('time_format', { enum: TIME_FORMATS }).notNull().default('24h'),
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: integer('week_start').notNull().default(0),
  /** Bit n set = day n is a working day. Default Sunday–Thursday (0b0011111 = 31). */
  workingDaysMask: integer('working_days_mask').notNull().default(31),
  ...auditColumns(),
});

export type CompanyRow = typeof company.$inferSelect;
export type CompanySettingsRow = typeof companySettings.$inferSelect;
