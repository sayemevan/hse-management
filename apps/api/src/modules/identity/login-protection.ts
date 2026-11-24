import type { AppConfig } from '../../config/config';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import type { AuditLogService } from '../../platform/audit-log';
import { NotificationService } from '../../platform/notification';
import { ProjectAudience } from './project-audience';
import type { UserRow } from './identity.schema';
import type { UserRepository } from './user.repository';

export interface FailedAttemptOutcome {
  statements: Statement[];
  /** True when this attempt triggered the lock. */
  locked: boolean;
}

/**
 * Failed-login protection (D-05): after `maxFailedLoginAttempts` consecutive failures the
 * account is locked for `lockDurationSeconds`, then unlocks by itself. The counter restarts
 * from zero when the lock starts and after every successful sign-in.
 */
export class LoginProtection {
  constructor(
    private readonly security: AppConfig['security'],
    private readonly users: UserRepository,
    private readonly audit: AuditLogService,
    private readonly db: Database,
  ) {}

  /** Whole minutes left on an active lock, or null when the account is not locked. */
  remainingLockMinutes(account: UserRow, now: number): number | null {
    const lockedUntil = account.lockedUntil?.getTime();
    if (lockedUntil === undefined || lockedUntil <= now) return null;
    return Math.max(1, Math.ceil((lockedUntil - now) / 60_000));
  }

  lockMinutes(): number {
    return Math.ceil(this.security.lockDurationSeconds / 60);
  }

  /** Statements that record one more failed attempt, plus the audit entries for it. */
  async recordFailure(
    account: UserRow,
    now: number,
    reason: string,
  ): Promise<FailedAttemptOutcome> {
    const failures = account.failedLoginCount + 1;
    const locked = failures >= this.security.maxFailedLoginAttempts;
    const lockedUntil = locked ? now + this.security.lockDurationSeconds * 1000 : null;

    const statements: Statement[] = [
      this.users.recordFailedAttempt(account.id, locked ? 0 : failures, lockedUntil),
      this.audit.entry({
        action: 'auth.login.failed',
        actorUserId: account.id,
        companyId: account.companyId,
        entityType: 'user',
        entityId: account.id,
        outcome: 'failure',
        newValue: { reason, email: account.email, failedAttempts: failures },
      }),
    ];
    if (locked) {
      statements.push(
        this.audit.entry({
          action: 'auth.account.locked',
          actorUserId: null,
          companyId: account.companyId,
          entityType: 'user',
          entityId: account.id,
          newValue: { lockedUntil },
        }),
      );
      // PLT-17 `user.locked`: the company's administrators, never the locked user.
      if (account.companyId) {
        const admins = await new ProjectAudience(this.db, () => now).companyRoleHolders(
          account.companyId,
          ['company_administrator'],
        );
        statements.push(
          ...new NotificationService(this.db, () => now).entries({
            type: 'user.locked',
            companyId: account.companyId,
            entityType: 'user',
            entityId: account.id,
            actorUserId: null,
            params: { userName: account.fullName },
            recipients: admins.filter((id) => id !== account.id),
          }),
        );
      }
    }
    return { statements, locked };
  }
}
