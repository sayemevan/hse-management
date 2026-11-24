import {
  type ApprovalResultDto,
  buildPaginationMeta,
  generateId,
  type PaginationMeta,
  type PaginationQuery,
  paginationOffset,
  type RegistrationDetailDto,
  type RegistrationStatus,
  type RegistrationSummaryDto,
} from '@hse/shared';

import type { Principal } from '../../core/auth/principal';
import { ValidationError } from '../../core/errors/app-error';
import { companyUrl, platformUrl } from '../../core/http/public-urls';
import { UnitOfWork } from '../../database/unit-of-work';
import { CompanyDirectory, CompanyRepository } from '../company';
import type { RegistrationContext } from './registration.context';
import {
  RegistrationAlreadyDecidedError,
  RegistrationConflictError,
  RegistrationNotFoundError,
} from './registration.errors';
import type { CompanyRegistrationRow } from './registration.schema';

export interface ApproveInput {
  phoneConfirmed: true;
  planCode?: string | undefined;
}

/** The System Owner's side of registration (US-011.3, US-011.4). */
export class RegistrationReviewService {
  constructor(private readonly ctx: RegistrationContext) {}

  async list(
    status: RegistrationStatus | undefined,
    page: PaginationQuery,
  ): Promise<{ items: RegistrationSummaryDto[]; meta: PaginationMeta }> {
    const { rows, total } = await this.ctx.registrations.list(
      status,
      paginationOffset(page),
      page.pageSize,
    );
    return { items: rows.map(toSummary), meta: buildPaginationMeta(page, total) };
  }

  async detail(id: string): Promise<RegistrationDetailDto> {
    const registration = await this.require(id);
    const reviews = await this.ctx.registrations.reviews(id);
    const names = await this.ctx.accounts.namesById([...new Set(reviews.map((r) => r.decidedBy))]);
    return {
      ...toSummary(registration),
      countryCode: registration.countryCode,
      city: registration.city,
      timeZone: registration.timeZone,
      defaultLanguage: registration.defaultLanguage,
      applicantPhone: registration.applicantPhone,
      applicantLanguage: registration.applicantLanguage,
      emailVerifiedAt: registration.emailVerifiedAt?.getTime() ?? null,
      companyId: registration.companyId,
      reviews: reviews.map((review) => ({
        decision: review.decision,
        reason: review.reason,
        phoneConfirmed: review.phoneConfirmed,
        previousPlanCode: review.previousPlanCode,
        newPlanCode: review.newPlanCode,
        decidedByName: names.get(review.decidedBy) ?? null,
        decidedAt: review.decidedAt.getTime(),
      })),
    };
  }

  /**
   * US-011.3: creates the company, its trial, the Company Administrator and the role in one
   * atomic batch, or nothing at all.
   */
  async approve(id: string, input: ApproveInput, reviewer: Principal): Promise<ApprovalResultDto> {
    const registration = await this.requireSubmitted(id);
    const planCode = input.planCode ?? registration.planCode;
    const planRow = await this.ctx.subscriptions.findActivePlan(planCode);
    if (!planRow) throw new ValidationError([{ path: 'planCode', message: 'planUnavailable' }]);

    if (
      (await this.ctx.companies.isSlugTaken(registration.slug)) ||
      (await this.ctx.accounts.isEmailInUse(registration.applicantEmail))
    ) {
      throw new RegistrationConflictError();
    }

    const { config } = this.ctx.deps;
    const now = this.ctx.now();
    const companyId = generateId();
    const userId = generateId();
    const trial = this.ctx.subscriptions.startTrial(
      companyId,
      planRow,
      config.registration.trialDays,
      reviewer.userId,
    );
    const signInUrl = companyUrl(config, registration.slug, '/login');
    const email = this.ctx.emails.enqueue({
      template: 'registration.approved',
      to: registration.applicantEmail,
      language: registration.applicantLanguage,
      companyId,
      data: {
        applicantName: registration.applicantName,
        companyName: registration.companyName,
        signInUrl,
        trialEndsAt: trial.trialEndsAt,
        timeZone: registration.timeZone,
      },
    });

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        ...this.ctx.companies.createCompany({
          id: companyId,
          name: registration.companyName,
          slug: registration.slug,
          countryCode: registration.countryCode,
          city: registration.city,
          timeZone: registration.timeZone,
          defaultLanguage: registration.defaultLanguage,
          contactEmail: registration.applicantEmail,
          contactPhone: registration.applicantPhone,
          createdBy: reviewer.userId,
        }),
        trial.statement,
        ...this.ctx.accounts.createCompanyAdministrator({
          userId,
          companyId,
          email: registration.applicantEmail,
          fullName: registration.applicantName,
          passwordHash: registration.passwordHash,
          language: registration.applicantLanguage,
          timeZone: registration.timeZone,
          createdBy: reviewer.userId,
        }),
        this.ctx.registrations.addReview({
          id: generateId(),
          registrationId: id,
          decision: 'approved',
          reason: null,
          phoneConfirmed: input.phoneConfirmed,
          previousPlanCode: planCode === registration.planCode ? null : registration.planCode,
          newPlanCode: planCode === registration.planCode ? null : planCode,
          decidedBy: reviewer.userId,
          now,
        }),
        this.ctx.registrations.markApproved(id, companyId, planCode, now, reviewer.userId),
        email.statement,
        this.ctx.audit.entry({
          action: 'registration.approved',
          actorUserId: reviewer.userId,
          companyId,
          entityType: 'company_registration',
          entityId: id,
          newValue: { planCode, phoneConfirmed: true },
        }),
        this.ctx.audit.entry({
          action: 'company.created',
          actorUserId: reviewer.userId,
          companyId,
          entityType: 'company',
          entityId: companyId,
          newValue: { slug: registration.slug, trialEndsAt: trial.trialEndsAt },
        }),
      )
      .commit();

    // FR-8: the new subdomain must work immediately.
    await this.companyDirectory().invalidate(registration.slug);
    await this.ctx.publish([email.job]);
    return { companyId, slug: registration.slug, signInUrl };
  }

  /** US-011.4: reject with a reason and send a resubmission link (valid 30 days). */
  async reject(id: string, reason: string, reviewer: Principal): Promise<void> {
    const registration = await this.requireSubmitted(id);
    const { config } = this.ctx.deps;
    const now = this.ctx.now();
    const token = await this.ctx.tokens.issue(
      'registration_resubmit',
      id,
      config.registration.resubmitTokenTtlMs,
    );
    const email = this.ctx.emails.enqueue({
      template: 'registration.rejected',
      to: registration.applicantEmail,
      language: registration.applicantLanguage,
      data: {
        applicantName: registration.applicantName,
        companyName: registration.companyName,
        reason,
      },
      secrets: {
        resubmitUrl: platformUrl(
          config,
          `/register/resubmit?token=${encodeURIComponent(token.token)}`,
        ),
      },
    });

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.registrations.addReview({
          id: generateId(),
          registrationId: id,
          decision: 'rejected',
          reason,
          phoneConfirmed: false,
          previousPlanCode: null,
          newPlanCode: null,
          decidedBy: reviewer.userId,
          now,
        }),
        this.ctx.registrations.markRejected(id, now, reviewer.userId),
        this.ctx.tokens.invalidateAll('registration_resubmit', id),
        token.statement,
        email.statement,
        this.ctx.audit.entry({
          action: 'registration.rejected',
          actorUserId: reviewer.userId,
          entityType: 'company_registration',
          entityId: id,
          newValue: { reason },
        }),
      )
      .commit();
    await this.ctx.publish([email.job]);
  }

  private async require(id: string): Promise<CompanyRegistrationRow> {
    const registration = await this.ctx.registrations.findById(id);
    if (!registration) throw new RegistrationNotFoundError();
    return registration;
  }

  private async requireSubmitted(id: string): Promise<CompanyRegistrationRow> {
    const registration = await this.require(id);
    if (registration.status !== 'submitted') throw new RegistrationAlreadyDecidedError();
    return registration;
  }

  private companyDirectory(): CompanyDirectory {
    const { deps } = this.ctx;
    return new CompanyDirectory(
      new CompanyRepository(deps.db),
      deps.cache,
      deps.config.tenancy.cacheTtlSeconds,
      deps.logger,
    );
  }
}

function toSummary(row: CompanyRegistrationRow): RegistrationSummaryDto {
  return {
    id: row.id,
    status: row.status,
    companyName: row.companyName,
    slug: row.slug,
    applicantName: row.applicantName,
    applicantEmail: row.applicantEmail,
    planCode: row.planCode,
    submittedAt: row.submittedAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
  };
}
