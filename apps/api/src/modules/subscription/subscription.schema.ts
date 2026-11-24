import { BILLING_CYCLES, PAYMENT_STATUSES } from '@hse/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { auditColumns, primaryKey } from '../../database/columns';
import { file } from '../../platform/file-storage';
import { company } from '../company';

/** Plan catalogue (PLT-06). Seeded by migration; never deleted, only deactivated. */
export const plan = sqliteTable(
  'plan',
  {
    ...primaryKey(),
    code: text('code').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    // NULL = unlimited (D-27).
    maxProjects: integer('max_projects'),
    maxUsers: integer('max_users'),
    maxStorageBytes: integer('max_storage_bytes').notNull(),
    // SAR × 100, excluding VAT; NULL until decided (F-02b).
    monthlyPriceHalalas: integer('monthly_price_halalas'),
    annualPriceHalalas: integer('annual_price_halalas'),
    sortOrder: integer('sort_order').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull(),
    ...auditColumns(),
  },
  (table) => [uniqueIndex('plan_code_unique').on(table.code)],
);

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'grace', 'read_only'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * One subscription per company (PLT-06, PLT-10). `status` is the last state recorded by the
 * lifecycle job; the effective state is computed from the dates (T-22, `lifecycle.ts`).
 */
export const subscription = sqliteTable(
  'subscription',
  {
    ...primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    planId: text('plan_id')
      .notNull()
      .references(() => plan.id),
    status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
    trialStartedAt: integer('trial_started_at', { mode: 'timestamp_ms' }),
    trialEndsAt: integer('trial_ends_at', { mode: 'timestamp_ms' }),
    billingCycle: text('billing_cycle', { enum: BILLING_CYCLES }),
    currentPeriodStart: integer('current_period_start', { mode: 'timestamp_ms' }),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),
    graceEndsAt: integer('grace_ends_at', { mode: 'timestamp_ms' }),
    readOnlySince: integer('read_only_since', { mode: 'timestamp_ms' }),
    // Plan of a confirmed period that starts later (PLT-10, O-34).
    pendingPlanId: text('pending_plan_id').references(() => plan.id),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('subscription_company_unique').on(table.companyId),
    index('subscription_status_idx').on(table.status),
    index('subscription_status_period_idx').on(table.status, table.currentPeriodEnd),
    index('subscription_status_trial_idx').on(table.status, table.trialEndsAt),
  ],
);

/** Payment-proof submissions and their review (PLT-13, PLT-14, T-27). */
export const payment = sqliteTable(
  'payment',
  {
    ...primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscription.id),
    planId: text('plan_id')
      .notNull()
      .references(() => plan.id),
    billingCycle: text('billing_cycle', { enum: BILLING_CYCLES }).notNull(),
    amountHalalas: integer('amount_halalas').notNull(),
    // YYYY-MM-DD, the date on the bank transfer.
    transferredOn: text('transferred_on').notNull(),
    reference: text('reference'),
    fileId: text('file_id')
      .notNull()
      .references(() => file.id),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull(),
    submittedBy: text('submitted_by').notNull(),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }).notNull(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    rejectionReason: text('rejection_reason'),
    confirmedPlanId: text('confirmed_plan_id').references(() => plan.id),
    confirmedBillingCycle: text('confirmed_billing_cycle', { enum: BILLING_CYCLES }),
    confirmedAmountHalalas: integer('confirmed_amount_halalas'),
    periodStart: integer('period_start', { mode: 'timestamp_ms' }),
    periodEnd: integer('period_end', { mode: 'timestamp_ms' }),
    ...auditColumns(),
  },
  (table) => [
    index('payment_company_status_idx').on(table.companyId, table.status),
    index('payment_status_submitted_idx').on(table.status, table.submittedAt),
    // PLT-13 FR-4: one pending payment per company.
    uniqueIndex('payment_one_pending_per_company')
      .on(table.companyId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export type PlanRow = typeof plan.$inferSelect;
export type SubscriptionRow = typeof subscription.$inferSelect;
export type PaymentRow = typeof payment.$inferSelect;
