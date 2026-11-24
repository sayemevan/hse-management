import {
  amountToHalalas,
  buildPaginationMeta,
  type confirmPaymentRequestSchema,
  type Language,
  type PaginationMeta,
  type PaginationQuery,
  paginationOffset,
  type PaymentDto,
  type PaymentStatus,
  type PlatformPaymentDetailDto,
  type PlatformPaymentSummaryDto,
  type PlatformSubscriptionDto,
  type SubscriptionState,
} from '@hse/shared';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import { NotFoundError } from '../../core/errors/app-error';
import { companyUrl } from '../../core/http/public-urls';
import type { Statement } from '../../database/unit-of-work';
import { UnitOfWork } from '../../database/unit-of-work';
import type { OpenedFile } from '../../platform/file-storage';
import type { CompanyRow } from '../company';
import {
  firstExceededLimit,
  limitsOf,
  PaymentAlreadyReviewedError,
  type PaymentRow,
  PlanLimitReachedError,
  PlanNotAvailableError,
  planName,
  type PlanRow,
  type SubscriptionAccess,
  toRiyals,
} from '../subscription';
import type { BillingContext } from './billing.context';
import { planIdsOf, toPaymentDto } from './payment-mapper';
import { afterTransition, needsRecording, recordTransition } from './subscription-transitions';

type ConfirmInput = z.output<typeof confirmPaymentRequestSchema>;

/** Sort weight for the overview: the states that need attention first (PLT-14 FR-7). */
const STATE_ORDER: Record<SubscriptionState, number> = {
  read_only: 0,
  grace: 1,
  trial: 2,
  active: 3,
};

/** The System Owner's side of billing (PLT-14). */
export class PaymentReviewService {
  constructor(private readonly ctx: BillingContext) {}

  /** FR-1: pending oldest first; other statuses newest first. */
  async list(
    status: PaymentStatus,
    page: PaginationQuery,
    language: Language,
  ): Promise<{ items: PlatformPaymentSummaryDto[]; meta: PaginationMeta }> {
    const { rows, total } = await this.ctx.payments.listByStatus(
      status,
      paginationOffset(page),
      page.pageSize,
    );
    const [plans, companies] = await Promise.all([
      this.ctx.subscriptions.plansById(planIdsOf(rows)),
      this.companiesById(rows.map((row) => row.companyId)),
    ]);
    const items = rows.map((row) => {
      const company = companies.get(row.companyId);
      const plan = plans.get(row.planId);
      return {
        id: row.id,
        companyName: company?.name ?? '',
        companySlug: company?.slug ?? '',
        planName: plan ? planName(plan, language) : '',
        billingCycle: row.billingCycle,
        amount: toRiyals(row.amountHalalas),
        transferredOn: row.transferredOn,
        status: row.status,
        submittedAt: row.submittedAt.getTime(),
      };
    });
    return { items, meta: buildPaginationMeta(page, total) };
  }

  countPending(): Promise<number> {
    return this.ctx.payments.countPending();
  }

  /** FR-2: the payment, its company, the subscription now and the company's other payments. */
  async detail(id: string, language: Language): Promise<PlatformPaymentDetailDto> {
    const row = await this.require(id);
    const company = await this.requireCompany(row.companyId);
    const [access, history, usage, file] = await Promise.all([
      this.ctx.access(row.companyId),
      this.ctx.payments.listForCompany(row.companyId),
      this.ctx.usage(row.companyId),
      this.ctx.files.find(row.fileId, row.companyId),
    ]);
    const plans = await this.ctx.subscriptions.plansById(planIdsOf(history));
    const names = await this.ctx.accounts.namesById(
      [row.submittedBy, row.reviewedBy].filter((value): value is string => value !== null),
    );
    return {
      ...toPaymentDto(row, plans, language),
      companyName: company.name,
      companySlug: company.slug,
      contactEmail: company.contactEmail,
      contactPhone: company.contactPhone,
      submittedByName: names.get(row.submittedBy) ?? null,
      reviewedByName: row.reviewedBy ? (names.get(row.reviewedBy) ?? null) : null,
      fileName: file?.fileName ?? '',
      fileContentType: file?.contentType ?? '',
      subscription: {
        state: access?.state ?? 'read_only',
        planCode: access?.plan.code ?? '',
        trialEndsAt: access?.dates.trialEndsAt ?? null,
        currentPeriodEnd: access?.dates.currentPeriodEnd ?? null,
        graceEndsAt: access?.state === 'grace' ? access.graceEndsAt : null,
      },
      usage,
      history: history
        .filter((other) => other.id !== row.id)
        .map((other) => toPaymentDto(other, plans, language)),
    };
  }

  /** FR-3 / T-28: the receipt, through the file service with the company's own scope. */
  async openFile(id: string): Promise<OpenedFile | null> {
    const row = await this.require(id);
    return this.ctx.files.open(row.fileId, row.companyId);
  }

  /** FR-4: confirm, compute the period, activate or renew, and tell the administrators. */
  async confirm(
    id: string,
    input: ConfirmInput,
    reviewer: Principal,
    language: Language,
  ): Promise<PaymentDto> {
    const row = await this.requirePending(id);
    const company = await this.requireCompany(row.companyId);
    const access = await this.ctx.access(row.companyId);
    if (!access) throw new NotFoundError();

    const plan = await this.confirmedPlan(row, input.planCode);
    const usage = await this.ctx.usage(row.companyId);
    const over = firstExceededLimit(plan, usage);
    if (over) {
      const limits = limitsOf(plan);
      throw new PlanLimitReachedError(
        over,
        over === 'storage' ? limits.storageBytes : (limits[over] ?? 0),
        over === 'storage' ? usage.storageBytes : usage[over],
      );
    }

    const cycle = input.billingCycle ?? row.billingCycle;
    const amountHalalas =
      input.amountReceived === undefined
        ? row.amountHalalas
        : amountToHalalas(input.amountReceived);
    const period = this.ctx.subscriptions.confirmedPeriod(access, plan.id, cycle);
    const applied = this.ctx.subscriptions.applyPeriod(access, period, reviewer.userId);
    const now = this.ctx.now();

    const admins = await this.ctx.accounts.listActiveCompanyAdministrators(
      company.id,
      company.defaultLanguage,
    );
    const subscriptionUrl = companyUrl(
      this.ctx.deps.config,
      company.slug,
      '/settings/subscription',
    );
    const emails = admins.map((admin) =>
      this.ctx.emails.enqueue({
        template: 'payment.confirmed',
        to: admin.email,
        language: admin.language,
        companyId: company.id,
        data: {
          fullName: admin.fullName,
          companyName: company.name,
          planName: planName(plan, admin.language),
          billingCycle: cycle,
          amount: toRiyals(amountHalalas),
          periodEnd: period.end,
          timeZone: company.timeZone,
          subscriptionUrl,
        },
      }),
    );

    const statements: Statement[] = [
      this.ctx.payments.confirm(
        id,
        {
          planId: plan.id,
          billingCycle: cycle,
          amountHalalas,
          periodStart: period.start,
          periodEnd: period.end,
        },
        reviewer.userId,
        now,
      ),
      applied.statement,
      this.ctx.audit.entry({
        action: 'payment.confirmed',
        actorUserId: reviewer.userId,
        companyId: company.id,
        entityType: 'payment',
        entityId: id,
        oldValue: {
          planId: row.planId,
          billingCycle: row.billingCycle,
          amountHalalas: row.amountHalalas,
        },
        newValue: {
          planId: plan.id,
          billingCycle: cycle,
          amountHalalas,
          periodStart: period.start,
          periodEnd: period.end,
        },
      }),
      this.ctx.audit.entry({
        action: subscriptionAction(access),
        actorUserId: reviewer.userId,
        companyId: company.id,
        entityType: 'subscription',
        entityId: access.subscription.id,
        oldValue: {
          status: access.subscription.status,
          currentPeriodEnd: access.dates.currentPeriodEnd,
        },
        newValue: { status: applied.state, currentPeriodEnd: period.end },
      }),
      ...emails.map((email) => email.statement),
    ];
    if (plan.id !== access.plan.id) {
      statements.push(
        this.ctx.audit.entry({
          action: 'subscription.plan_changed',
          actorUserId: reviewer.userId,
          companyId: company.id,
          entityType: 'subscription',
          entityId: access.subscription.id,
          oldValue: { planId: access.plan.id },
          newValue: { planId: plan.id, from: period.start },
        }),
      );
    }
    if (company.status === 'read_only') {
      statements.push(
        this.ctx.companies.setAccessStatus(company.id, 'active', reviewer.userId, now),
      );
    }

    await this.commitReview(id, new UnitOfWork(this.ctx.deps.db).add(...statements));
    await afterTransition(this.ctx, company);
    await this.ctx.publish(emails.map((email) => email.job));

    const saved = await this.require(id);
    return toPaymentDto(
      saved,
      await this.ctx.subscriptions.plansById(planIdsOf([saved])),
      language,
    );
  }

  /** FR-5: reject with a reason; the pending-proof hold ends at once (PLT-10 FR-2). */
  async reject(id: string, reason: string, reviewer: Principal): Promise<void> {
    const row = await this.requirePending(id);
    const company = await this.requireCompany(row.companyId);
    const admins = await this.ctx.accounts.listActiveCompanyAdministrators(
      company.id,
      company.defaultLanguage,
    );
    const subscriptionUrl = companyUrl(
      this.ctx.deps.config,
      company.slug,
      '/settings/subscription',
    );
    const emails = admins.map((admin) =>
      this.ctx.emails.enqueue({
        template: 'payment.rejected',
        to: admin.email,
        language: admin.language,
        companyId: company.id,
        data: { fullName: admin.fullName, companyName: company.name, reason, subscriptionUrl },
      }),
    );
    await this.commitReview(
      id,
      new UnitOfWork(this.ctx.deps.db).add(
        this.ctx.payments.reject(id, reason, reviewer.userId, this.ctx.now()),
        this.ctx.audit.entry({
          action: 'payment.rejected',
          actorUserId: reviewer.userId,
          companyId: company.id,
          entityType: 'payment',
          entityId: id,
          newValue: { reason },
        }),
        ...emails.map((email) => email.statement),
      ),
    );
    await this.ctx.publish(emails.map((email) => email.job));

    // Without the hold the company may now be read-only: record it straight away.
    const access = await this.ctx.access(company.id);
    if (access && needsRecording(access)) {
      await new UnitOfWork(this.ctx.deps.db)
        .add(...recordTransition(this.ctx, access, company, reviewer.userId))
        .commit();
      await afterTransition(this.ctx, company);
    }
  }

  /** FR-7: every company's subscription, the ones needing attention first. */
  async subscriptions(
    state: SubscriptionState | undefined,
    language: Language,
  ): Promise<PlatformSubscriptionDto[]> {
    const all = await this.ctx.subscriptions.accessForAll(this.ctx.lifecycle);
    const companies = await this.companiesById(all.map((access) => access.subscription.companyId));
    return all
      .filter((access) => state === undefined || access.state === state)
      .flatMap((access) => {
        const company = companies.get(access.subscription.companyId);
        if (!company) return [];
        return [
          {
            companyName: company.name,
            companySlug: company.slug,
            planName: planName(access.plan, language),
            state: access.state,
            billingCycle: access.subscription.billingCycle,
            deadline: access.deadline,
            readOnlySince: access.readOnlySince,
            paymentPendingId: access.pendingPayment?.id ?? null,
          },
        ];
      })
      .sort(
        (a, b) =>
          STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
          (a.deadline ?? Number.MAX_SAFE_INTEGER) - (b.deadline ?? Number.MAX_SAFE_INTEGER) ||
          a.companyName.localeCompare(b.companyName),
      );
  }

  /** A batch whose payment was reviewed meanwhile fails as a whole (FR-6). */
  private async commitReview(id: string, work: UnitOfWork): Promise<void> {
    try {
      await work.commit();
    } catch (error) {
      if ((await this.ctx.payments.findById(id))?.status !== 'pending') {
        throw new PaymentAlreadyReviewedError();
      }
      throw error;
    }
  }

  private async confirmedPlan(row: PaymentRow, planCode: string | undefined): Promise<PlanRow> {
    if (planCode !== undefined) {
      const chosen = await this.ctx.subscriptions.findActivePlan(planCode);
      if (!chosen) throw new PlanNotAvailableError();
      return chosen;
    }
    const asked = (await this.ctx.subscriptions.plansById([row.planId])).get(row.planId);
    if (!asked?.isActive) throw new PlanNotAvailableError();
    return asked;
  }

  private async companiesById(ids: string[]): Promise<Map<string, CompanyRow>> {
    const rows = await this.ctx.companies.findManyByIds([...new Set(ids)]);
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async require(id: string): Promise<PaymentRow> {
    const row = await this.ctx.payments.findById(id);
    if (!row) throw new NotFoundError();
    return row;
  }

  private async requirePending(id: string): Promise<PaymentRow> {
    const row = await this.require(id);
    if (row.status !== 'pending') throw new PaymentAlreadyReviewedError();
    return row;
  }

  private async requireCompany(id: string): Promise<CompanyRow> {
    const row = await this.ctx.companies.findById(id);
    if (!row) throw new NotFoundError();
    return row;
  }
}

/** Audit name for what a confirmation does to the subscription (PLT-10 audit list). */
function subscriptionAction(
  access: SubscriptionAccess,
): 'subscription.activated' | 'subscription.renewed' | 'subscription.read_only_ended' {
  if (access.state === 'read_only') return 'subscription.read_only_ended';
  return access.dates.currentPeriodEnd === null ? 'subscription.activated' : 'subscription.renewed';
}
