import {
  generateId,
  type InvitationPreviewDto,
  type InviteUserRequest,
  type Language,
  type UserListItemDto,
  type UserListStatus,
} from '@hse/shared';

import { PasswordHasher } from '../../core/auth/password-hasher';
import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError } from '../../core/errors/app-error';
import { UnitOfWork } from '../../database/unit-of-work';
import type { OneTimeTokenRow } from '../../platform/one-time-token';
import { CompanyReadOnlyError } from '../company';
import { PlanLimitService } from '../subscription';
import { AccountProvisioning } from './account-provisioning.service';
import type { AuthService, LoginResult } from './auth.service';
import type { IdentityContext } from './identity.context';
import {
  EmailInUseError,
  InvitationLinkInvalidError,
  InvitationNotPendingError,
  InvitationResendLimitError,
  UserNotFoundError,
} from './identity.errors';
import type { UserInvitationRow, UserRow } from './identity.schema';
import { tenantUrl } from './tenant-urls';
import type { CompanyUserRow } from './user.repository';

const DAY_MS = 24 * 3_600_000;
/** US-006 FR-5: five resends per invitation per day, on top of the first email. */
const MAX_SENDS_PER_DAY = 6;

export interface UserListResult {
  items: UserListItemDto[];
  total: number;
}

/** Inviting users and accepting invitations (US-006, T-15, T-16, T-17). */
export class InvitationService {
  private readonly hasher: PasswordHasher;

  constructor(
    private readonly ctx: IdentityContext,
    private readonly auth: AuthService,
  ) {
    this.hasher = new PasswordHasher(ctx.deps.config.security.passwordHashIterations);
  }

  /** FR-9: the company's users with their invitation state. */
  async list(
    search: string | undefined,
    page: { page: number; pageSize: number },
  ): Promise<UserListResult> {
    const company = this.company();
    const { rows, total } = await this.ctx.users.listForCompany(company.id, search, {
      limit: page.pageSize,
      offset: (page.page - 1) * page.pageSize,
    });
    const now = this.ctx.now();
    return { total, items: rows.map((row) => toListItem(row, now)) };
  }

  /** FR-1 to FR-4. */
  async invite(
    principal: Principal,
    input: InviteUserRequest & { email: string },
  ): Promise<UserListItemDto> {
    const company = this.writableCompany();
    if (await new AccountProvisioning(this.ctx.deps.db).isEmailInUse(input.email)) {
      throw new EmailInUseError();
    }
    await this.requireFreeSeat(company.id);

    const now = this.ctx.now();
    const userId = generateId();
    const invitationId = generateId();
    const expiresAt = now + this.ctx.deps.config.accounts.invitationTtlMs;
    const inviter = await this.inviterName(principal.userId);
    const { token, statements, job } = await this.invitationEmail({
      userId,
      email: input.email,
      fullName: input.fullName,
      language: input.language,
      inviterName: inviter,
      expiresAt,
    });

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.users.createInvited({
          id: userId,
          companyId: company.id,
          email: input.email,
          fullName: input.fullName,
          language: input.language,
          invitedBy: principal.userId,
        }),
        this.ctx.roles.assign({
          id: generateId(),
          userId,
          roleCode: input.roleCode,
          scopeLevel: 'company',
          companyId: company.id,
          projectId: null,
          createdBy: principal.userId,
        }),
        this.ctx.invitations.create({
          id: invitationId,
          companyId: company.id,
          userId,
          invitedBy: principal.userId,
          roleCode: input.roleCode,
          language: input.language,
          now,
          expiresAt,
        }),
        token,
        ...statements,
        this.ctx.audit.entry({
          action: 'user.invited',
          actorUserId: principal.userId,
          companyId: company.id,
          entityType: 'user',
          entityId: userId,
          newValue: { roleCode: input.roleCode, language: input.language },
        }),
      )
      .commit();
    await this.ctx.publish([job]);

    return {
      id: userId,
      fullName: input.fullName,
      email: input.email,
      roleCodes: [input.roleCode],
      projectCount: 0,
      status: 'invitation_pending',
      invitationSentAt: now,
      invitationExpiresAt: expiresAt,
      lastLoginAt: null,
    };
  }

  /** FR-5: a new link; the old one stops working. */
  async resend(principal: Principal, userId: string): Promise<void> {
    const company = this.writableCompany();
    const { account, invitation } = await this.pending(company.id, userId);

    const now = this.ctx.now();
    const sent = await this.ctx.tokens.countIssuedSince('invitation', account.id, now - DAY_MS);
    if (sent >= MAX_SENDS_PER_DAY) throw new InvitationResendLimitError();

    const expiresAt = now + this.ctx.deps.config.accounts.invitationTtlMs;
    const { token, statements, job } = await this.invitationEmail({
      userId: account.id,
      email: account.email,
      fullName: account.fullName,
      language: invitation.language,
      inviterName: await this.inviterName(principal.userId),
      expiresAt,
    });

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.tokens.invalidateAll('invitation', account.id),
        token,
        ...statements,
        this.ctx.invitations.markResent(
          invitation.id,
          principal.userId,
          now,
          expiresAt,
          invitation.resendCount + 1,
        ),
        this.ctx.audit.entry({
          action: 'user.invitation_resent',
          actorUserId: principal.userId,
          companyId: company.id,
          entityType: 'user',
          entityId: account.id,
        }),
      )
      .commit();
    await this.ctx.publish([job]);
  }

  /** FR-6: the link stops working and the pending user is archived, freeing the email. */
  async cancel(principal: Principal, userId: string): Promise<void> {
    const company = this.company();
    const { account, invitation } = await this.pending(company.id, userId);
    const now = this.ctx.now();
    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.invitations.revoke(invitation.id, principal.userId, now),
        this.ctx.tokens.invalidateAll('invitation', account.id),
        this.ctx.users.archiveInvited(account.id, principal.userId, now),
        this.ctx.audit.entry({
          action: 'user.invitation_revoked',
          actorUserId: principal.userId,
          companyId: company.id,
          entityType: 'user',
          entityId: account.id,
        }),
      )
      .commit();
  }

  /** FR-8: shows who the link is for, without changing anything. */
  async preview(token: string): Promise<InvitationPreviewDto> {
    const { account } = await this.usableInvitation(token);
    return { companyName: this.company().name, fullName: account.fullName, email: account.email };
  }

  /** FR-7: sets the password, activates the user and signs them in, in one batch. */
  async accept(token: string, password: string): Promise<LoginResult> {
    const { row, account, invitation } = await this.usableInvitation(token);
    const now = this.ctx.now();
    const passwordHash = await this.hasher.hash(password);

    const statements = [
      this.ctx.tokens.consume(row),
      this.ctx.users.activateInvited(account.id, passwordHash, now),
      this.ctx.invitations.markAccepted(invitation.id, account.id, now),
      this.ctx.audit.entry({
        action: 'user.invitation_accepted',
        actorUserId: account.id,
        companyId: account.companyId,
        entityType: 'user',
        entityId: account.id,
      }),
    ];

    const jobs = [];
    const inviter = await this.ctx.users.findById(invitation.invitedBy);
    if (inviter?.status === 'active') {
      const email = this.ctx.emails.enqueue({
        template: 'user.invitation_accepted',
        to: inviter.email,
        language: inviter.preferredLanguage ?? this.company().defaultLanguage,
        companyId: account.companyId,
        data: {
          inviterName: inviter.fullName,
          fullName: account.fullName,
          usersUrl: tenantUrl(this.ctx.deps.config, this.ctx.deps.tenant, '/settings/users'),
        },
      });
      statements.push(email.statement);
      jobs.push(email.job);
    }

    const result = await this.auth.signIn(
      { ...account, status: 'active', passwordHash, passwordChangedAt: new Date(now) },
      now,
      statements,
    );
    await this.ctx.publish(jobs);
    return result;
  }

  private async usableInvitation(
    token: string,
  ): Promise<{ row: OneTimeTokenRow; account: UserRow; invitation: UserInvitationRow }> {
    const company = this.company();
    const row = await this.ctx.tokens.find('invitation', token);
    if (!row || !this.ctx.tokens.isUsable(row)) throw new InvitationLinkInvalidError();
    // T-17: a link for company A doesn't work on company B's subdomain.
    const account = await this.ctx.users.findInCompany(row.subjectId, company.id);
    if (account?.status !== 'pending_invitation') throw new InvitationLinkInvalidError();
    const invitation = await this.ctx.invitations.findOpenForUser(account.id);
    if (!invitation) throw new InvitationLinkInvalidError();
    return { row, account, invitation };
  }

  private async pending(
    companyId: string,
    userId: string,
  ): Promise<{ account: UserRow; invitation: UserInvitationRow }> {
    const account = await this.ctx.users.findInCompany(userId, companyId);
    if (!account) throw new UserNotFoundError();
    const invitation = await this.ctx.invitations.findOpenForUser(account.id);
    if (account.status !== 'pending_invitation' || !invitation) {
      throw new InvitationNotPendingError();
    }
    return { account, invitation };
  }

  /** O-26, PLT-12 FR-4: active plus pending users must stay within the plan limit. */
  private async requireFreeSeat(companyId: string): Promise<void> {
    await new PlanLimitService(this.ctx.subscriptions).assertCanAdd(
      companyId,
      'users',
      await this.ctx.users.countSeats(companyId),
    );
  }

  private async invitationEmail(input: {
    userId: string;
    email: string;
    fullName: string;
    language: Language;
    inviterName: string;
    expiresAt: number;
  }) {
    const company = this.company();
    const { config, tenant } = this.ctx.deps;
    const issued = await this.ctx.tokens.issue(
      'invitation',
      input.userId,
      input.expiresAt - this.ctx.now(),
    );
    const acceptUrl = new URL(tenantUrl(config, tenant, '/invite/accept'));
    acceptUrl.searchParams.set('token', issued.token);
    const email = this.ctx.emails.enqueue({
      template: 'user.invitation',
      to: input.email,
      language: input.language,
      companyId: company.id,
      data: {
        fullName: input.fullName,
        companyName: company.name,
        invitedByName: input.inviterName,
        expiresAt: input.expiresAt,
        timeZone: company.timeZone,
      },
      secrets: { acceptUrl: acceptUrl.toString() },
    });
    return { token: issued.statement, statements: [email.statement], job: email.job };
  }

  private async inviterName(userId: string): Promise<string> {
    return (await this.ctx.users.findById(userId))?.fullName ?? this.company().name;
  }

  private company(): TenantCompany {
    const { tenant } = this.ctx.deps;
    if (tenant.kind !== 'company') throw new NotFoundError();
    return tenant.company;
  }

  /** D-30: a read-only company can't invite (or resend). */
  private writableCompany(): TenantCompany {
    const company = this.company();
    if (company.readOnly) throw new CompanyReadOnlyError();
    return company;
  }
}

function toListItem(row: CompanyUserRow, now: number): UserListItemDto {
  const { user: account, invitation } = row;
  let status: UserListStatus;
  if (account.status === 'pending_invitation') {
    status =
      invitation && invitation.expiresAt.getTime() > now
        ? 'invitation_pending'
        : 'invitation_expired';
  } else if (account.status === 'suspended' || account.status === 'locked') {
    status = account.status;
  } else {
    status = 'active';
  }
  return {
    id: account.id,
    fullName: account.fullName,
    email: account.email,
    roleCodes: row.roleCodes,
    projectCount: row.projectCount,
    status,
    invitationSentAt: invitation?.lastSentAt.getTime() ?? null,
    invitationExpiresAt: invitation?.expiresAt.getTime() ?? null,
    lastLoginAt: account.lastLoginAt?.getTime() ?? null,
  };
}
