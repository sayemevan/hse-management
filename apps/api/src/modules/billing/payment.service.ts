import {
  amountToHalalas,
  generateId,
  type Language,
  PAYMENT_LIMITS,
  type PaymentDto,
  type SubmitPaymentFields,
  type submitPaymentFieldsSchema,
  type SubscriptionSummaryDto,
} from '@hse/shared';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import { platformUrl } from '../../core/http/public-urls';
import { UnitOfWork } from '../../database/unit-of-work';
import {
  DAY_MS,
  firstExceededLimit,
  isoDateIn,
  limitsOf,
  PaymentAlreadyPendingError,
  PaymentAlreadyReviewedError,
  PlanLimitReachedError,
  PlanNotAvailableError,
  planName,
  type SubscriptionAccess,
} from '../subscription';
import type { BillingContext } from './billing.context';
import { planIdsOf, toPaymentDto } from './payment-mapper';

type SubmitInput = z.output<typeof submitPaymentFieldsSchema>;
export type { SubmitPaymentFields };

/** The company's side of billing (PLT-13): the subscription page and payment proofs. */
export class PaymentService {
  constructor(private readonly ctx: BillingContext) {}

  /** FR-1: plan, state, dates, usage, limits, bank details and the pending payment. */
  async summary(tenant: TenantCompany, language: Language): Promise<SubscriptionSummaryDto> {
    const access = await this.requireAccess(tenant);
    const usage = await this.ctx.usage(tenant.id);
    const pending = access.pendingPayment
      ? toPaymentDto(
          access.pendingPayment,
          await this.ctx.subscriptions.plansById(planIdsOf([access.pendingPayment])),
          language,
        )
      : null;
    const row = access.subscription;
    return {
      planCode: access.plan.code,
      planName: planName(access.plan, language),
      state: access.state,
      billingCycle: row.billingCycle,
      trialEndsAt: access.dates.trialEndsAt,
      currentPeriodStart: access.dates.currentPeriodStart,
      currentPeriodEnd: access.dates.currentPeriodEnd,
      graceEndsAt: access.state === 'grace' ? access.graceEndsAt : null,
      readOnlySince: access.readOnlySince,
      nextPlanName: access.nextPlan ? planName(access.nextPlan, language) : null,
      usage,
      limits: limitsOf(access.plan),
      bankDetails: { ...this.ctx.deps.config.billing.bankDetails },
      pendingPayment: pending,
    };
  }

  /** FR-7: every payment of the company, newest first. */
  async list(tenant: TenantCompany, language: Language): Promise<PaymentDto[]> {
    const rows = await this.ctx.payments.listForCompany(tenant.id);
    const plans = await this.ctx.subscriptions.plansById(planIdsOf(rows));
    return rows.map((row) => toPaymentDto(row, plans, language));
  }

  /** FR-2 – FR-5: store the receipt and the payment, and tell every System Owner. */
  async submit(
    tenant: TenantCompany,
    principal: Principal,
    input: SubmitInput,
    receipt: File,
    language: Language,
  ): Promise<PaymentDto> {
    const access = await this.requireAccess(tenant);
    if (access.pendingPayment) throw new PaymentAlreadyPendingError();

    const plan = await this.ctx.subscriptions.findActivePlan(input.planCode);
    if (!plan) throw new PlanNotAvailableError();
    const usage = await this.ctx.usage(tenant.id);
    const over = firstExceededLimit(plan, usage);
    if (over) {
      const limits = limitsOf(plan);
      const used = over === 'storage' ? usage.storageBytes : usage[over];
      const limit = over === 'storage' ? limits.storageBytes : (limits[over] ?? 0);
      throw new PlanLimitReachedError(over, limit, used);
    }
    this.checkTransferDate(input.transferredOn, tenant.timeZone);

    const stored = await this.ctx.files.store({
      companyId: tenant.id,
      category: 'payment_proof',
      uploadedBy: principal.userId,
      file: receipt,
    });

    const now = this.ctx.now();
    const id = generateId();
    const amountHalalas = amountToHalalas(input.amount);
    const owners = await this.ctx.accounts.listActiveSystemOwners();
    const emails = owners.map((owner) =>
      this.ctx.emails.enqueue({
        template: 'payment.submitted',
        to: owner.email,
        language: owner.language,
        companyId: tenant.id,
        data: {
          fullName: owner.fullName,
          companyName: tenant.name,
          planName: planName(plan, owner.language),
          billingCycle: input.billingCycle,
          amount: amountHalalas / 100,
          reviewUrl: platformUrl(this.ctx.deps.config, `/platform/payments/${id}`),
        },
      }),
    );

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        stored.statement,
        this.ctx.payments.create({
          id,
          companyId: tenant.id,
          subscriptionId: access.subscription.id,
          planId: plan.id,
          billingCycle: input.billingCycle,
          amountHalalas,
          transferredOn: input.transferredOn,
          reference: input.reference ?? null,
          fileId: stored.row.id,
          submittedBy: principal.userId,
          submittedAt: new Date(now),
        }),
        this.ctx.audit.entry({
          action: 'file.uploaded',
          actorUserId: principal.userId,
          companyId: tenant.id,
          entityType: 'file',
          entityId: stored.row.id,
          newValue: {
            category: stored.row.category,
            sizeBytes: stored.row.sizeBytes,
            contentType: stored.row.contentType,
          },
        }),
        this.ctx.audit.entry({
          action: 'payment.submitted',
          actorUserId: principal.userId,
          companyId: tenant.id,
          entityType: 'payment',
          entityId: id,
          newValue: {
            planCode: plan.code,
            billingCycle: input.billingCycle,
            amountHalalas,
            transferredOn: input.transferredOn,
          },
        }),
        ...emails.map((email) => email.statement),
      )
      .commit()
      .catch(async (error: unknown) => {
        // The unique index lost a race with another submission (FR-4).
        if (await this.ctx.payments.findPending(tenant.id)) throw new PaymentAlreadyPendingError();
        throw error;
      });
    await this.ctx.publish(emails.map((email) => email.job));

    const row = await this.ctx.payments.findById(id);
    if (!row) throw new NotFoundError();
    return toPaymentDto(row, await this.ctx.subscriptions.plansById([plan.id]), language);
  }

  /** FR-6: a pending payment can be withdrawn; its receipt is retired. */
  async withdraw(tenant: TenantCompany, principal: Principal, id: string): Promise<void> {
    const row = await this.ctx.payments.findInCompany(id, tenant.id);
    if (!row) throw new NotFoundError();
    if (row.status !== 'pending') throw new PaymentAlreadyReviewedError();
    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.payments.withdraw(id, principal.userId, this.ctx.now()),
        this.ctx.files.remove(row.fileId, principal.userId),
        this.ctx.audit.entry({
          action: 'payment.withdrawn',
          actorUserId: principal.userId,
          companyId: tenant.id,
          entityType: 'payment',
          entityId: id,
        }),
        this.ctx.audit.entry({
          action: 'file.deleted',
          actorUserId: principal.userId,
          companyId: tenant.id,
          entityType: 'file',
          entityId: row.fileId,
          newValue: { category: 'payment_proof' },
        }),
      )
      .commit()
      .catch(async (error: unknown) => {
        // Reviewed meanwhile: the guarded update failed the whole batch.
        if ((await this.ctx.payments.findById(id))?.status !== 'pending') {
          throw new PaymentAlreadyReviewedError();
        }
        throw error;
      });
  }

  /** Validation: not in the future and not older than 60 days, in the company's time zone. */
  private checkTransferDate(transferredOn: string, timeZone: string): void {
    const now = this.ctx.now();
    const today = isoDateIn(now, timeZone);
    const earliest = isoDateIn(now - PAYMENT_LIMITS.transferMaxAgeDays * DAY_MS, timeZone);
    const valid = !Number.isNaN(Date.parse(transferredOn));
    if (!valid || transferredOn > today || transferredOn < earliest) {
      throw new ValidationError([{ path: 'transferredOn', message: 'invalidTransferDate' }]);
    }
  }

  private async requireAccess(tenant: TenantCompany): Promise<SubscriptionAccess> {
    const access = await this.ctx.access(tenant.id);
    if (!access) throw new NotFoundError('This company has no subscription yet.');
    return access;
  }
}
