import {
  type BillingCycle,
  generateId,
  HALALAS_PER_RIYAL,
  type Language,
  type PlanDto,
  type SubscriptionState,
} from '@hse/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import {
  deadlineFor,
  effectiveState,
  type LifecycleDates,
  type LifecycleSettings,
  nextPeriodStart,
  periodEnd,
} from './lifecycle';
import {
  payment,
  type PaymentRow,
  plan,
  type PlanRow,
  subscription,
  type SubscriptionRow,
} from './subscription.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialStart {
  statement: Statement;
  trialEndsAt: number;
}

/** A subscription as it stands right now (PLT-10 FR-7). */
export interface SubscriptionAccess {
  subscription: SubscriptionRow;
  /** The plan whose limits apply now. */
  plan: PlanRow;
  /** Plan of a confirmed period that hasn't started yet, if it differs. */
  nextPlan: PlanRow | null;
  state: SubscriptionState;
  dates: LifecycleDates;
  graceEndsAt: number | null;
  /** The deadline that matters in this state (trial, period or grace end). */
  deadline: number | null;
  readOnlySince: number | null;
  pendingPayment: PaymentRow | null;
}

export interface ConfirmedPeriod {
  planId: string;
  billingCycle: BillingCycle;
  start: number;
  end: number;
}

const datesOf = (row: SubscriptionRow): LifecycleDates => ({
  trialEndsAt: row.trialEndsAt?.getTime() ?? null,
  currentPeriodStart: row.currentPeriodStart?.getTime() ?? null,
  currentPeriodEnd: row.currentPeriodEnd?.getTime() ?? null,
});

/** Plans and subscriptions (PLT-06, PLT-10). The only code that touches these tables. */
export class SubscriptionService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  async listActivePlans(): Promise<PlanRow[]> {
    return this.db
      .select()
      .from(plan)
      .where(eq(plan.isActive, true))
      .orderBy(asc(plan.sortOrder))
      .all();
  }

  async findActivePlan(code: string): Promise<PlanRow | undefined> {
    return this.db
      .select()
      .from(plan)
      .where(and(eq(plan.code, code), eq(plan.isActive, true)))
      .get();
  }

  async plansById(ids: readonly string[]): Promise<Map<string, PlanRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(plan)
      .where(inArray(plan.id, [...new Set(ids)]))
      .all();
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** The company's subscription with the plan that applies now (US-006 O-26, US-015). */
  async forCompany(
    companyId: string,
  ): Promise<{ subscription: SubscriptionRow; plan: PlanRow } | undefined> {
    const row = await this.db
      .select()
      .from(subscription)
      .where(eq(subscription.companyId, companyId))
      .get();
    if (!row) return undefined;
    const plans = await this.plansById(
      row.pendingPlanId ? [row.planId, row.pendingPlanId] : [row.planId],
    );
    const current = plans.get(this.currentPlanId(row, this.clock()));
    return current ? { subscription: row, plan: current } : undefined;
  }

  /** FR-7: state, dates, plan and pending payment of one company, at the current time. */
  async access(
    companyId: string,
    settings: LifecycleSettings,
  ): Promise<SubscriptionAccess | undefined> {
    const row = await this.db
      .select()
      .from(subscription)
      .where(eq(subscription.companyId, companyId))
      .get();
    if (!row) return undefined;
    const pending = await this.db
      .select()
      .from(payment)
      .where(and(eq(payment.companyId, companyId), eq(payment.status, 'pending')))
      .get();
    const plans = await this.plansById(
      row.pendingPlanId ? [row.planId, row.pendingPlanId] : [row.planId],
    );
    return this.describe(row, pending ?? null, plans, settings);
  }

  /** Every subscription with its pending payment, for the daily job and the overview. */
  async accessForAll(settings: LifecycleSettings): Promise<SubscriptionAccess[]> {
    const rows = await this.db.select().from(subscription).all();
    const pending = await this.db.select().from(payment).where(eq(payment.status, 'pending')).all();
    const pendingByCompany = new Map(pending.map((row) => [row.companyId, row]));
    const plans = await this.plansById(
      rows.flatMap((row) => (row.pendingPlanId ? [row.planId, row.pendingPlanId] : [row.planId])),
    );
    return rows.flatMap((row) => {
      const access = this.describe(
        row,
        pendingByCompany.get(row.companyId) ?? null,
        plans,
        settings,
      );
      return access ? [access] : [];
    });
  }

  /** Statement creating a company's trial subscription (D-29: starts at approval). */
  startTrial(companyId: string, planRow: PlanRow, trialDays: number, actorId: string): TrialStart {
    const now = this.clock();
    const trialEndsAt = now + trialDays * DAY_MS;
    const statement = this.db.insert(subscription).values({
      id: generateId(),
      companyId,
      planId: planRow.id,
      status: 'trial',
      trialStartedAt: new Date(now),
      trialEndsAt: new Date(trialEndsAt),
      createdBy: actorId,
      updatedBy: actorId,
    });
    return { statement, trialEndsAt };
  }

  /** FR-3 / O-33: the period a payment confirmed now would pay for. */
  confirmedPeriod(
    access: SubscriptionAccess,
    planId: string,
    cycle: BillingCycle,
  ): ConfirmedPeriod {
    const start = nextPeriodStart(access.state, access.dates, this.clock());
    return { planId, billingCycle: cycle, start, end: periodEnd(start, cycle) };
  }

  /**
   * FR-3: records a confirmed period. A period that starts now switches the plan and leaves
   * grace or read-only; one that starts later keeps the current plan until then.
   */
  applyPeriod(
    access: SubscriptionAccess,
    period: ConfirmedPeriod,
    actorId: string,
  ): { statement: Statement; state: SubscriptionState } {
    const now = this.clock();
    const startsNow = period.start <= now;
    const row = access.subscription;
    // During the trial the trial runs on; a later stacked period keeps the current plan.
    const state: SubscriptionState = access.state === 'trial' ? 'trial' : 'active';
    const statement = this.db
      .update(subscription)
      .set({
        status: state,
        billingCycle: period.billingCycle,
        currentPeriodStart: new Date(period.start),
        currentPeriodEnd: new Date(period.end),
        planId: startsNow ? period.planId : this.currentPlanId(row, now),
        pendingPlanId:
          startsNow || period.planId === this.currentPlanId(row, now) ? null : period.planId,
        graceEndsAt: null,
        readOnlySince: null,
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(eq(subscription.id, row.id));
    return { statement, state };
  }

  /** FR-4: records the effective state and applies a plan whose period has started. */
  recordState(access: SubscriptionAccess, actorId: string | null): Statement {
    const now = this.clock();
    const row = access.subscription;
    return this.db
      .update(subscription)
      .set({
        status: access.state,
        planId: this.currentPlanId(row, now),
        pendingPlanId:
          this.currentPlanId(row, now) === row.pendingPlanId ? null : row.pendingPlanId,
        graceEndsAt:
          access.state === 'grace' ? new Date(access.graceEndsAt ?? now) : row.graceEndsAt,
        // When read-only really began (the deadline), not when the job noticed it.
        readOnlySince:
          access.state === 'read_only'
            ? (row.readOnlySince ?? new Date(access.readOnlySince ?? now))
            : null,
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(eq(subscription.id, row.id));
  }

  private currentPlanId(row: SubscriptionRow, now: number): string {
    const startsAt = row.currentPeriodStart?.getTime();
    return row.pendingPlanId && startsAt !== undefined && startsAt <= now
      ? row.pendingPlanId
      : row.planId;
  }

  private describe(
    row: SubscriptionRow,
    pending: PaymentRow | null,
    plans: Map<string, PlanRow>,
    settings: LifecycleSettings,
  ): SubscriptionAccess | undefined {
    const now = this.clock();
    const current = plans.get(this.currentPlanId(row, now));
    if (!current) return undefined;
    const next =
      row.pendingPlanId && row.pendingPlanId !== current.id
        ? (plans.get(row.pendingPlanId) ?? null)
        : null;
    const dates = datesOf(row);
    const state = effectiveState(dates, now, settings, pending?.submittedAt.getTime() ?? null);
    const graceEndsAt =
      dates.currentPeriodEnd === null ? null : dates.currentPeriodEnd + settings.graceMs;
    return {
      subscription: row,
      plan: current,
      nextPlan: next,
      state,
      dates,
      graceEndsAt,
      deadline: deadlineFor(state, dates, settings),
      readOnlySince:
        state === 'read_only'
          ? (row.readOnlySince?.getTime() ?? readOnlyStart(dates, settings))
          : null,
      pendingPayment: pending,
    };
  }
}

/** When read-only began according to the dates (before the job has recorded it). */
function readOnlyStart(dates: LifecycleDates, settings: LifecycleSettings): number | null {
  if (dates.currentPeriodEnd !== null) return dates.currentPeriodEnd + settings.graceMs;
  return dates.trialEndsAt;
}

export function toRiyals(halalas: number): number {
  return halalas / HALALAS_PER_RIYAL;
}

export function planName(row: PlanRow, language: Language): string {
  return language === 'ar' ? row.nameAr : row.nameEn;
}

export function toPlanDto(row: PlanRow, language: Language): PlanDto {
  const riyals = (halalas: number | null) => (halalas === null ? null : toRiyals(halalas));
  return {
    code: row.code,
    name: planName(row, language),
    maxProjects: row.maxProjects,
    maxUsers: row.maxUsers,
    maxStorageBytes: row.maxStorageBytes,
    monthlyPrice: riyals(row.monthlyPriceHalalas),
    annualPrice: riyals(row.annualPriceHalalas),
  };
}
