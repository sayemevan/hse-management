import type { CurrentUserDto, Language } from '@hse/shared';

import { PasswordHasher } from '../../core/auth/password-hasher';
import type { Principal } from '../../core/auth/principal';
import { UnitOfWork } from '../../database/unit-of-work';
import type { IdentityContext } from './identity.context';
import {
  AccountTemporarilyLockedError,
  CurrentPasswordIncorrectError,
  PasswordUnchangedError,
} from './identity.errors';
import type { UserRow } from './identity.schema';
import { LoginProtection } from './login-protection';
import { tenantUrl } from './tenant-urls';
import type { ProfileUpdate } from './user.repository';
import { buildCurrentUser } from './user.mapper';

/** The signed-in user's own account: profile basics, language and password (US-005, PLT-03). */
export class AccountService {
  private readonly hasher: PasswordHasher;
  private readonly protection: LoginProtection;

  constructor(private readonly ctx: IdentityContext) {
    const { security } = ctx.deps.config;
    this.hasher = new PasswordHasher(security.passwordHashIterations);
    this.protection = new LoginProtection(security, ctx.users, ctx.audit, ctx.deps.db);
  }

  async me(account: UserRow): Promise<CurrentUserDto> {
    const roles = await this.ctx.roles.listActiveForUser(account.id, this.ctx.now());
    return buildCurrentUser(this.ctx, account, roles);
  }

  /** US-007 (O-27): name, phone, language and time zone. Only changed fields are written. */
  async updateProfile(account: UserRow, input: ProfileUpdate): Promise<CurrentUserDto> {
    const changes: ProfileUpdate = {};
    if (input.fullName !== undefined && input.fullName !== account.fullName)
      changes.fullName = input.fullName;
    if (input.phone !== undefined && input.phone !== account.phone) changes.phone = input.phone;
    if (
      input.preferredLanguage !== undefined &&
      input.preferredLanguage !== account.preferredLanguage
    )
      changes.preferredLanguage = input.preferredLanguage;
    if (input.timeZone !== undefined && input.timeZone !== account.timeZone)
      changes.timeZone = input.timeZone;

    const changed = Object.keys(changes);
    if (changed.length > 0) {
      await new UnitOfWork(this.ctx.deps.db)
        .add(
          this.ctx.users.updateProfile(account.id, changes, this.ctx.now()),
          this.ctx.audit.entry({
            action: 'user.profile.updated',
            actorUserId: account.id,
            companyId: account.companyId,
            entityType: 'user',
            entityId: account.id,
            // Names of changed fields only; language and time zone values are not personal.
            newValue: {
              fields: changed,
              ...(changes.preferredLanguage !== undefined
                ? { preferredLanguage: changes.preferredLanguage }
                : {}),
              ...(changes.timeZone !== undefined ? { timeZone: changes.timeZone } : {}),
            },
          }),
        )
        .commit();
    }
    return this.me({ ...account, ...changes });
  }

  async setPreferredLanguage(account: UserRow, language: Language): Promise<CurrentUserDto> {
    await new UnitOfWork(this.ctx.deps.db)
      .add(this.ctx.users.setPreferredLanguage(account.id, language, this.ctx.now()))
      .commit();
    return this.me({ ...account, preferredLanguage: language });
  }

  /**
   * Changes the password and signs out every other session (O-4).
   * Wrong current passwords count towards the lockout (D-05). Returns the number of sessions ended.
   */
  async changePassword(
    principal: Principal,
    account: UserRow,
    currentPassword: string,
    newPassword: string,
  ): Promise<number> {
    const now = this.ctx.now();

    const lockMinutes = this.protection.remainingLockMinutes(account, now);
    if (lockMinutes !== null) throw new AccountTemporarilyLockedError(lockMinutes);

    const current = await this.hasher.verify(currentPassword, account.passwordHash);
    if (!current.valid) {
      const outcome = await this.protection.recordFailure(account, now, 'wrong_current_password');
      await new UnitOfWork(this.ctx.deps.db).add(...outcome.statements).commit();
      if (outcome.locked) throw new AccountTemporarilyLockedError(this.protection.lockMinutes());
      throw new CurrentPasswordIncorrectError();
    }

    if ((await this.hasher.verify(newPassword, account.passwordHash)).valid) {
      throw new PasswordUnchangedError();
    }

    const newHash = await this.hasher.hash(newPassword);
    const otherSessions = await this.ctx.sessions.listActiveIdsExcept(
      account.id,
      principal.sessionId,
      now,
    );

    const work = new UnitOfWork(this.ctx.deps.db).add(
      this.ctx.users.changePassword(account.id, newHash, now),
      this.ctx.audit.entry({
        action: 'auth.password.changed',
        actorUserId: account.id,
        companyId: account.companyId,
        entityType: 'user',
        entityId: account.id,
        newValue: { otherSessionsEnded: otherSessions.length },
      }),
    );
    for (const sessionId of otherSessions) {
      work.add(
        this.ctx.sessions.revoke(sessionId, 'password_changed', now),
        this.ctx.audit.entry({
          action: 'auth.session.revoked',
          actorUserId: account.id,
          companyId: account.companyId,
          entityType: 'user_session',
          entityId: sessionId,
          newValue: { reason: 'password_changed' },
        }),
      );
    }
    const email = this.ctx.emails.enqueue({
      template: 'auth.password_changed',
      to: account.email,
      language: account.preferredLanguage ?? this.defaultLanguage(),
      companyId: account.companyId,
      data: {
        fullName: account.fullName,
        changedAt: now,
        timeZone: account.timeZone ?? this.defaultTimeZone(),
        forgotPasswordUrl: tenantUrl(
          this.ctx.deps.config,
          this.ctx.deps.tenant,
          '/forgot-password',
        ),
      },
    });
    work.add(email.statement);
    await work.commit();
    await this.ctx.publish([email.job]);
    return otherSessions.length;
  }

  private defaultLanguage(): Language {
    const { tenant } = this.ctx.deps;
    return tenant.kind === 'company' ? tenant.company.defaultLanguage : 'en';
  }

  private defaultTimeZone(): string {
    const { tenant } = this.ctx.deps;
    return tenant.kind === 'company' ? tenant.company.timeZone : 'Asia/Riyadh';
  }
}
