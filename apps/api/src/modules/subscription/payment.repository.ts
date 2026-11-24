import type { BillingCycle, PaymentStatus } from '@hse/shared';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { payment, type PaymentRow } from './subscription.schema';

export type NewPayment = Omit<
  PaymentRow,
  | 'status'
  | 'reviewedBy'
  | 'reviewedAt'
  | 'rejectionReason'
  | 'confirmedPlanId'
  | 'confirmedBillingCycle'
  | 'confirmedAmountHalalas'
  | 'periodStart'
  | 'periodEnd'
  | 'createdAt'
  | 'createdBy'
  | 'updatedAt'
  | 'updatedBy'
>;

export interface PaymentConfirmation {
  planId: string;
  billingCycle: BillingCycle;
  amountHalalas: number;
  periodStart: number;
  periodEnd: number;
}

/** Keeps `submitted_at` on a pending payment and fails the batch otherwise (see below). */
const onlyWhenPending = sql`CASE WHEN ${payment.status} = 'pending' THEN ${payment.submittedAt} ELSE NULL END`;

/** The only code that reads or writes the `payment` table (PLT-13, PLT-14). */
export class PaymentRepository {
  constructor(private readonly db: Database) {}

  create(input: NewPayment): Statement {
    return this.db.insert(payment).values({
      ...input,
      status: 'pending',
      createdBy: input.submittedBy,
      updatedBy: input.submittedBy,
    });
  }

  async findById(id: string): Promise<PaymentRow | undefined> {
    return this.db.select().from(payment).where(eq(payment.id, id)).get();
  }

  async findInCompany(id: string, companyId: string): Promise<PaymentRow | undefined> {
    return this.db
      .select()
      .from(payment)
      .where(and(eq(payment.id, id), eq(payment.companyId, companyId)))
      .get();
  }

  async findPending(companyId: string): Promise<PaymentRow | undefined> {
    return this.db
      .select()
      .from(payment)
      .where(and(eq(payment.companyId, companyId), eq(payment.status, 'pending')))
      .get();
  }

  async listForCompany(companyId: string): Promise<PaymentRow[]> {
    return this.db
      .select()
      .from(payment)
      .where(eq(payment.companyId, companyId))
      .orderBy(desc(payment.submittedAt))
      .all();
  }

  /** Pending: oldest first (the queue); otherwise newest first. */
  async listByStatus(
    status: PaymentStatus,
    offset: number,
    limit: number,
  ): Promise<{ rows: PaymentRow[]; total: number }> {
    const order = status === 'pending' ? asc(payment.submittedAt) : desc(payment.submittedAt);
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(payment)
        .where(eq(payment.status, status))
        .orderBy(order)
        .limit(limit)
        .offset(offset)
        .all(),
      this.db.select({ total: count() }).from(payment).where(eq(payment.status, status)).get(),
    ]);
    return { rows, total: totals?.total ?? 0 };
  }

  async countPending(): Promise<number> {
    const row = await this.db
      .select({ total: count() })
      .from(payment)
      .where(eq(payment.status, 'pending'))
      .get();
    return row?.total ?? 0;
  }

  /**
   * Each transition is only valid on a pending payment. On any other status the update writes
   * NULL into a NOT NULL column, so the whole batch it belongs to fails and nothing else in it
   * (period, emails, audit) is written: two reviewers can never both confirm (PLT-14 FR-6).
   */
  withdraw(id: string, actorId: string, now: number): Statement {
    return this.db
      .update(payment)
      .set({
        status: 'withdrawn',
        submittedAt: onlyWhenPending,
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(eq(payment.id, id));
  }

  confirm(id: string, confirmation: PaymentConfirmation, actorId: string, now: number): Statement {
    return this.db
      .update(payment)
      .set({
        status: 'confirmed',
        submittedAt: onlyWhenPending,
        reviewedBy: actorId,
        reviewedAt: new Date(now),
        confirmedPlanId: confirmation.planId,
        confirmedBillingCycle: confirmation.billingCycle,
        confirmedAmountHalalas: confirmation.amountHalalas,
        periodStart: new Date(confirmation.periodStart),
        periodEnd: new Date(confirmation.periodEnd),
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(eq(payment.id, id));
  }

  reject(id: string, reason: string, actorId: string, now: number): Statement {
    return this.db
      .update(payment)
      .set({
        status: 'rejected',
        submittedAt: onlyWhenPending,
        reviewedBy: actorId,
        reviewedAt: new Date(now),
        rejectionReason: reason,
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(eq(payment.id, id));
  }
}
