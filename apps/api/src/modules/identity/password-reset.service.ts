import { type Language, maskEmail, type ResetPasswordPreviewDto } from '@hse/shared';

import { PasswordHasher } from '../../core/auth/password-hasher';
import { UnitOfWork } from '../../database/unit-of-work';
import type { OneTimeTokenRow } from '../../platform/one-time-token';
import { belongsToTenant, type IdentityContext } from './identity.context';
import { PasswordUnchangedError, ResetLinkInvalidError } from './identity.errors';
import type { UserRow } from './identity.schema';
import { tenantUrl } from './tenant-urls';

const HOUR_MS = 3_600_000;

/** Forgot and reset password (US-002, US-003, T-16, T-21). */
export class PasswordResetService {
  private readonly hasher: PasswordHasher;

  constructor(private readonly ctx: IdentityContext) {
    this.hasher = new PasswordHasher(ctx.deps.config.security.passwordHashIterations);
  }

  /**
   * US-002: sends a reset link only to an active user of this tenant, and answers the same
   * way whatever happens (no account enumeration). Locked users may reset (FR-3).
   */
  async requestReset(email: string): Promise<void> {
    const { config, tenant } = this.ctx.deps;
    const account = await this.ctx.users.findByEmailInTenant(email, tenant);
    if (account?.status !== 'active') return;

    const now = this.ctx.now();
    const recent = await this.ctx.tokens.countIssuedSince(
      'password_reset',
      account.id,
      now - HOUR_MS,
    );
    if (recent >= config.accounts.passwordResetLimitPerHour) {
      this.ctx.deps.logger.info('password reset limit reached', { userId: account.id });
      return;
    }

    const { passwordResetTtlMs } = config.accounts;
    const token = await this.ctx.tokens.issue('password_reset', account.id, passwordResetTtlMs);
    const resetUrl = new URL(tenantUrl(config, tenant, '/reset-password'));
    resetUrl.searchParams.set('token', token.token);

    const email_ = this.ctx.emails.enqueue({
      template: 'auth.password_reset',
      to: account.email,
      language: this.languageFor(account),
      companyId: account.companyId,
      data: { fullName: account.fullName, minutes: Math.round(passwordResetTtlMs / 60_000) },
      secrets: { resetUrl: resetUrl.toString() },
    });

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        // FR-2: only the newest link works.
        this.ctx.tokens.invalidateAll('password_reset', account.id),
        token.statement,
        email_.statement,
        this.ctx.audit.entry({
          action: 'auth.password_reset.requested',
          actorUserId: null,
          companyId: account.companyId,
          entityType: 'user',
          entityId: account.id,
        }),
      )
      .commit();
    await this.ctx.publish([email_.job]);
  }

  /** US-003 FR-1: checks the link without consuming it (email scanners open links). */
  async preview(token: string): Promise<ResetPasswordPreviewDto> {
    const { account } = await this.usableToken(token);
    return { email: maskEmail(account.email) };
  }

  /**
   * US-003 FR-2: sets the new password, clears the lock and ends every session, in one batch.
   * Returns the number of sessions ended.
   */
  async reset(token: string, password: string): Promise<number> {
    const { row, account } = await this.usableToken(token);
    if ((await this.hasher.verify(password, account.passwordHash)).valid) {
      throw new PasswordUnchangedError();
    }

    const now = this.ctx.now();
    const sessionIds = await this.ctx.sessions.listActiveIds(account.id, now);
    const { config, tenant } = this.ctx.deps;
    const email = this.ctx.emails.enqueue({
      template: 'auth.password_changed',
      to: account.email,
      language: this.languageFor(account),
      companyId: account.companyId,
      data: {
        fullName: account.fullName,
        changedAt: now,
        timeZone: account.timeZone ?? this.defaultTimeZone(),
        forgotPasswordUrl: tenantUrl(config, tenant, '/forgot-password'),
      },
    });

    const work = new UnitOfWork(this.ctx.deps.db).add(
      this.ctx.tokens.consume(row),
      this.ctx.users.changePassword(account.id, await this.hasher.hash(password), now),
      email.statement,
      this.ctx.audit.entry({
        action: 'auth.password.reset',
        actorUserId: account.id,
        companyId: account.companyId,
        entityType: 'user',
        entityId: account.id,
        newValue: { sessionsEnded: sessionIds.length },
      }),
    );
    for (const sessionId of sessionIds) {
      work.add(
        this.ctx.sessions.revoke(sessionId, 'password_reset', now),
        this.ctx.audit.entry({
          action: 'auth.session.revoked',
          actorUserId: account.id,
          companyId: account.companyId,
          entityType: 'user_session',
          entityId: sessionId,
          newValue: { reason: 'password_reset' },
        }),
      );
    }
    await work.commit();
    await this.ctx.publish([email.job]);
    return sessionIds.length;
  }

  /** The token must be unused, unexpired, for an active user of this tenant (FR-4). */
  private async usableToken(token: string): Promise<{ row: OneTimeTokenRow; account: UserRow }> {
    const row = await this.ctx.tokens.find('password_reset', token);
    if (!row || !this.ctx.tokens.isUsable(row)) throw new ResetLinkInvalidError();
    const account = await this.ctx.users.findById(row.subjectId);
    if (account?.status !== 'active' || !belongsToTenant(account, this.ctx.deps.tenant)) {
      throw new ResetLinkInvalidError();
    }
    return { row, account };
  }

  private languageFor(account: UserRow): Language {
    const { tenant } = this.ctx.deps;
    return (
      account.preferredLanguage ??
      (tenant.kind === 'company' ? tenant.company.defaultLanguage : 'en')
    );
  }

  private defaultTimeZone(): string {
    const { tenant } = this.ctx.deps;
    return tenant.kind === 'company' ? tenant.company.timeZone : 'Asia/Riyadh';
  }
}
