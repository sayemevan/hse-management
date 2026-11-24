import {
  generateId,
  type Language,
  RESERVED_SLUGS,
  type ResubmissionFormDto,
  type SlugAvailabilityDto,
  isValidSlug,
} from '@hse/shared';

import { PasswordHasher } from '../../core/auth/password-hasher';
import { ValidationError } from '../../core/errors/app-error';
import { platformUrl } from '../../core/http/public-urls';
import { UnitOfWork } from '../../database/unit-of-work';
import type { JobMessage } from '../../platform/jobs';
import type { RegistrationContext } from './registration.context';
import {
  BotCheckFailedError,
  SlugUnavailableError,
  TokenInvalidError,
} from './registration.errors';
import type { EditableRegistrationFields } from './registration.repository';
import type { CompanyRegistrationRow } from './registration.schema';

const HOUR_MS = 3_600_000;

export interface RegistrationInput extends EditableRegistrationFields {
  applicantEmail: string;
  password: string;
  turnstileToken: string;
}

export interface ResubmissionInput extends EditableRegistrationFields {
  token: string;
  password?: string;
  turnstileToken: string;
}

/** The applicant's side of registration (US-011.1, US-011.2, US-011.5). */
export class RegistrationService {
  private readonly hasher: PasswordHasher;

  constructor(private readonly ctx: RegistrationContext) {
    this.hasher = new PasswordHasher(ctx.deps.config.security.passwordHashIterations);
  }

  /** US-011.1 FR-1: live availability. `ownRegistrationId` lets a resubmission keep its slug. */
  async slugAvailability(slug: string, ownRegistrationId?: string): Promise<SlugAvailabilityDto> {
    if (RESERVED_SLUGS.includes(slug)) return { slug, available: false, reason: 'reserved' };
    if (!isValidSlug(slug)) return { slug, available: false, reason: 'invalid' };
    if (await this.ctx.companies.isSlugTaken(slug))
      return { slug, available: false, reason: 'taken' };
    const open = await this.ctx.registrations.findOpenBySlug(slug);
    if (open && open.id !== ownRegistrationId) return { slug, available: false, reason: 'taken' };
    return { slug, available: true };
  }

  /** US-011.1: create an application and send the verification email. */
  async register(input: RegistrationInput): Promise<void> {
    await this.requireHuman(input.turnstileToken);
    await this.requireAvailableSlug(input.slug);
    await this.requireActivePlan(input.planCode);

    // FR-7: answer the same way when the email is in use, but send a different email.
    const emailInUse =
      (await this.ctx.accounts.isEmailInUse(input.applicantEmail)) ||
      (await this.ctx.registrations.findOpenByEmail(input.applicantEmail)) !== undefined;
    if (emailInUse) {
      const email = this.ctx.emails.enqueue({
        template: 'registration.already_exists',
        to: input.applicantEmail,
        language: input.applicantLanguage,
        data: { platformUrl: platformUrl(this.ctx.deps.config, '/') },
      });
      await new UnitOfWork(this.ctx.deps.db).add(email.statement).commit();
      await this.ctx.publish([email.job]);
      return;
    }

    const id = generateId();
    const { registration } = this.ctx.deps.config;
    const token = await this.ctx.tokens.issue(
      'registration_email',
      id,
      registration.verifyTokenTtlMs,
    );
    const email = this.verificationEmail(
      input.applicantEmail,
      input.applicantLanguage,
      {
        applicantName: input.applicantName,
        companyName: input.companyName,
      },
      token.token,
    );

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.registrations.create({
          id,
          ...pickEditable(input),
          applicantEmail: input.applicantEmail,
          passwordHash: await this.hasher.hash(input.password),
          ipAddress: this.ctx.deps.meta.ipAddress,
          now: this.ctx.now(),
        }),
        token.statement,
        email.statement,
        this.ctx.audit.entry({
          action: 'registration.created',
          actorUserId: null,
          entityType: 'company_registration',
          entityId: id,
          newValue: { slug: input.slug, planCode: input.planCode },
        }),
      )
      .commit();
    await this.ctx.publish([email.job]);
  }

  /** US-011.2: consume the link, submit the application, notify System Owners. */
  async verifyEmail(token: string): Promise<void> {
    const row = await this.ctx.tokens.find('registration_email', token);
    if (!row) throw new TokenInvalidError();
    const registration = await this.ctx.registrations.findById(row.subjectId);
    if (!registration) throw new TokenInvalidError();

    // FR-5: a second click on an already-verified application is a success.
    if (registration.emailVerifiedAt && registration.status !== 'pending_email_verification')
      return;
    if (!this.ctx.tokens.isUsable(row) || registration.status !== 'pending_email_verification') {
      throw new TokenInvalidError();
    }

    const now = this.ctx.now();
    const { statements, jobs } = await this.submissionNotifications(registration);
    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.tokens.consume(row),
        this.ctx.registrations.markSubmitted(registration.id, now, 'pending_email_verification'),
        ...statements,
        this.ctx.audit.entry({
          action: 'registration.email_verified',
          actorUserId: null,
          entityType: 'company_registration',
          entityId: registration.id,
        }),
      )
      .commit();
    await this.ctx.publish(jobs);
  }

  /** US-011.2 FR-4: never reveals whether an application exists. */
  async resendVerification(email: string): Promise<void> {
    const registration = await this.ctx.registrations.findOpenByEmail(email);
    if (registration?.status !== 'pending_email_verification') return;

    const { registration: settings } = this.ctx.deps.config;
    // Count resends only: the first link was issued together with the application.
    const recent = await this.ctx.tokens.countIssuedSince(
      'registration_email',
      registration.id,
      Math.max(this.ctx.now() - HOUR_MS, registration.createdAt.getTime() + 1),
    );
    if (recent >= settings.resendLimitPerHour) {
      this.ctx.deps.logger.info('verification resend limit reached', {
        registrationId: registration.id,
      });
      return;
    }

    const token = await this.ctx.tokens.issue(
      'registration_email',
      registration.id,
      settings.verifyTokenTtlMs,
    );
    const message = this.verificationEmail(
      registration.applicantEmail,
      registration.applicantLanguage,
      { applicantName: registration.applicantName, companyName: registration.companyName },
      token.token,
    );
    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.tokens.invalidateAll('registration_email', registration.id),
        token.statement,
        message.statement,
      )
      .commit();
    await this.ctx.publish([message.job]);
  }

  /** US-011.5: the application behind a resubmission link, without the password hash. */
  async resubmissionForm(token: string): Promise<ResubmissionFormDto> {
    const { registration, reason } = await this.loadResubmission(token);
    return {
      companyName: registration.companyName,
      slug: registration.slug,
      countryCode: registration.countryCode,
      city: registration.city,
      timeZone: registration.timeZone,
      defaultLanguage: registration.defaultLanguage,
      applicantName: registration.applicantName,
      applicantEmail: registration.applicantEmail,
      applicantPhone: registration.applicantPhone,
      planCode: registration.planCode,
      rejectionReason: reason,
    };
  }

  /** US-011.5: update the rejected application and send it back for review. */
  async resubmit(input: ResubmissionInput): Promise<void> {
    await this.requireHuman(input.turnstileToken);
    const { registration, tokenRow } = await this.loadResubmission(input.token);
    await this.requireAvailableSlug(input.slug, registration.id);
    await this.requireActivePlan(input.planCode);

    const fields = pickEditable(input);
    const changed = (Object.keys(fields) as (keyof EditableRegistrationFields)[]).filter(
      (key) => fields[key] !== registration[key],
    );
    const updated = { ...registration, ...fields };
    const { statements, jobs } = await this.submissionNotifications(updated);

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.tokens.consume(tokenRow),
        this.ctx.registrations.resubmit(
          registration.id,
          fields,
          input.password ? await this.hasher.hash(input.password) : null,
          this.ctx.now(),
        ),
        ...statements,
        this.ctx.audit.entry({
          action: 'registration.resubmitted',
          actorUserId: null,
          entityType: 'company_registration',
          entityId: registration.id,
          // Field names only, never values (US-011.5 audit requirements).
          newValue: { changedFields: input.password ? [...changed, 'password'] : changed },
        }),
      )
      .commit();
    await this.ctx.publish(jobs);
  }

  // ---- helpers -----------------------------------------------------------------------

  private async loadResubmission(token: string) {
    const tokenRow = await this.ctx.tokens.find('registration_resubmit', token);
    if (!tokenRow || !this.ctx.tokens.isUsable(tokenRow)) throw new TokenInvalidError();
    const registration = await this.ctx.registrations.findById(tokenRow.subjectId);
    if (registration?.status !== 'rejected') throw new TokenInvalidError();
    const [latest] = await this.ctx.registrations.reviews(registration.id);
    return { registration, tokenRow, reason: latest?.reason ?? '' };
  }

  private async requireHuman(token: string): Promise<void> {
    if (!(await this.ctx.deps.botCheck.verify(token, this.ctx.deps.meta.ipAddress))) {
      throw new BotCheckFailedError();
    }
  }

  private async requireAvailableSlug(slug: string, ownRegistrationId?: string): Promise<void> {
    const availability = await this.slugAvailability(slug, ownRegistrationId);
    if (!availability.available) throw new SlugUnavailableError(availability.reason ?? 'taken');
  }

  private async requireActivePlan(code: string): Promise<void> {
    if (!(await this.ctx.subscriptions.findActivePlan(code))) {
      throw new ValidationError([{ path: 'planCode', message: 'planUnavailable' }]);
    }
  }

  private verificationEmail(
    to: string,
    language: Language,
    data: { applicantName: string; companyName: string },
    token: string,
  ) {
    return this.ctx.emails.enqueue({
      template: 'registration.verify_email',
      to,
      language,
      data,
      secrets: {
        verifyUrl: platformUrl(
          this.ctx.deps.config,
          `/register/verify?token=${encodeURIComponent(token)}`,
        ),
      },
    });
  }

  /** Confirmation to the applicant and a notice to every System Owner (O-18). */
  private async submissionNotifications(registration: CompanyRegistrationRow) {
    const owners = await this.ctx.accounts.listActiveSystemOwners();
    const messages = [
      this.ctx.emails.enqueue({
        template: 'registration.submitted',
        to: registration.applicantEmail,
        language: registration.applicantLanguage,
        data: { applicantName: registration.applicantName, companyName: registration.companyName },
      }),
      ...owners.map((owner) =>
        this.ctx.emails.enqueue({
          template: 'registration.new_for_review',
          to: owner.email,
          language: owner.language,
          data: {
            companyName: registration.companyName,
            slug: registration.slug,
            applicantName: registration.applicantName,
            reviewUrl: platformUrl(
              this.ctx.deps.config,
              `/platform/registrations/${registration.id}`,
            ),
          },
        }),
      ),
    ];
    return {
      statements: messages.map((message) => message.statement),
      jobs: messages.map((message): JobMessage => message.job),
    };
  }
}

function pickEditable(input: EditableRegistrationFields): EditableRegistrationFields {
  return {
    companyName: input.companyName,
    slug: input.slug,
    countryCode: input.countryCode,
    city: input.city,
    timeZone: input.timeZone,
    defaultLanguage: input.defaultLanguage,
    applicantName: input.applicantName,
    applicantPhone: input.applicantPhone,
    applicantLanguage: input.applicantLanguage,
    planCode: input.planCode,
  };
}
