import { LANGUAGES, REGISTRATION_STATUSES } from '@hse/shared';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { auditColumns, primaryKey } from '../../database/columns';
import { company } from '../company';
import { plan } from '../subscription';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

// An application is "open" until it is approved or closed. Open applications reserve
// their subdomain (O-16) and their applicant email (D-08).
const isOpen = sql`status NOT IN ('approved', 'closed')`;

/** A company's application to join the platform (US-011.1, T-8). */
export const companyRegistration = sqliteTable(
  'company_registration',
  {
    ...primaryKey(),
    status: text('status', { enum: REGISTRATION_STATUSES }).notNull(),
    companyName: text('company_name').notNull(),
    slug: text('slug').notNull(),
    countryCode: text('country_code').notNull(),
    city: text('city').notNull(),
    timeZone: text('time_zone').notNull(),
    defaultLanguage: text('default_language', { enum: LANGUAGES }).notNull(),
    applicantName: text('applicant_name').notNull(),
    applicantEmail: text('applicant_email').notNull(),
    applicantPhone: text('applicant_phone').notNull(),
    applicantLanguage: text('applicant_language', { enum: LANGUAGES }).notNull(),
    // O-12: becomes the Company Administrator's password on approval.
    passwordHash: text('password_hash').notNull(),
    planCode: text('plan_code')
      .notNull()
      .references(() => plan.code),
    termsAcceptedAt: timestamp('terms_accepted_at').notNull(),
    emailVerifiedAt: timestamp('email_verified_at'),
    submittedAt: timestamp('submitted_at'),
    decidedAt: timestamp('decided_at'),
    companyId: text('company_id').references(() => company.id),
    ipAddress: text('ip_address'),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('company_registration_open_slug_unique').on(table.slug).where(isOpen),
    uniqueIndex('company_registration_open_email_unique').on(table.applicantEmail).where(isOpen),
    index('company_registration_status_idx').on(table.status, table.submittedAt),
  ],
);

/** Every approve / reject decision, kept as history (US-011.3, US-011.4). */
export const registrationReview = sqliteTable(
  'registration_review',
  {
    ...primaryKey(),
    registrationId: text('registration_id')
      .notNull()
      .references(() => companyRegistration.id),
    decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
    reason: text('reason'),
    phoneConfirmed: integer('phone_confirmed', { mode: 'boolean' }).notNull(),
    previousPlanCode: text('previous_plan_code'),
    newPlanCode: text('new_plan_code'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at').notNull(),
  },
  (table) => [index('registration_review_registration_idx').on(table.registrationId)],
);

export type CompanyRegistrationRow = typeof companyRegistration.$inferSelect;
export type RegistrationReviewRow = typeof registrationReview.$inferSelect;
