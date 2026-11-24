import type { SessionDto } from '@hse/shared';

import type { Principal } from '../../core/auth/principal';
import { UnitOfWork } from '../../database/unit-of-work';
import { TenantAccessDeniedError } from '../company';
import { belongsToTenant, type IdentityContext } from './identity.context';
import {
  AccountInactiveError,
  CannotRevokeCurrentSessionError,
  SessionExpiredError,
  SessionNotFoundError,
} from './identity.errors';
import type { UserRow, UserSessionRow } from './identity.schema';

/** Per-request session validation (T-2, T-3) and session management (US-010). */
export class SessionService {
  constructor(private readonly ctx: IdentityContext) {}

  /**
   * Confirms the token's session is usable right now, records activity at most once per
   * interval, and returns the signed-in account.
   */
  async validate(principal: Principal): Promise<UserRow> {
    const now = this.ctx.now();
    const found = await this.ctx.sessions.findWithUser(principal.sessionId);
    if (found?.session.userId !== principal.userId) throw new SessionExpiredError();

    const { session, user: account } = found;
    if (!isActive(session, now)) throw new SessionExpiredError();
    if (account.status !== 'active' || account.deletedAt) throw new AccountInactiveError();

    if (!belongsToTenant(account, this.ctx.deps.tenant)) {
      await this.ctx.audit.record({
        action: 'tenant.access.denied',
        actorUserId: account.id,
        companyId: account.companyId,
        entityType: 'user',
        entityId: account.id,
        outcome: 'failure',
        newValue: {
          requestedCompanyId:
            this.ctx.deps.tenant.kind === 'company' ? this.ctx.deps.tenant.company.id : 'platform',
        },
      });
      throw new TenantAccessDeniedError();
    }

    const { activityWriteIntervalSeconds, idleTimeoutSeconds } = this.ctx.deps.config.session;
    if (now - session.lastActivityAt.getTime() >= activityWriteIntervalSeconds * 1000) {
      await new UnitOfWork(this.ctx.deps.db)
        .add(this.ctx.sessions.touch(session.id, now, now + idleTimeoutSeconds * 1000))
        .commit();
    }
    return account;
  }

  async list(principal: Principal): Promise<SessionDto[]> {
    const sessions = await this.ctx.sessions.listActiveForUser(principal.userId, this.ctx.now());
    return sessions.map((session) => ({
      id: session.id,
      deviceLabel: session.deviceLabel,
      browser: session.browser,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.getTime(),
      lastActivityAt: session.lastActivityAt.getTime(),
      isCurrent: session.id === principal.sessionId,
    }));
  }

  /** Ends one of the user's other sessions. Ending an already-ended session is not an error. */
  async revoke(principal: Principal, account: UserRow, sessionId: string): Promise<void> {
    if (sessionId === principal.sessionId) throw new CannotRevokeCurrentSessionError();

    const session = await this.ctx.sessions.findForUser(sessionId, principal.userId);
    if (!session) throw new SessionNotFoundError();
    if (!isActive(session, this.ctx.now())) return;

    await this.revokeAll(account, [sessionId], 'user_revoked');
  }

  /** Ends every session of the user except the current one. Returns how many were ended. */
  async revokeOthers(principal: Principal, account: UserRow): Promise<number> {
    const ids = await this.ctx.sessions.listActiveIdsExcept(
      principal.userId,
      principal.sessionId,
      this.ctx.now(),
    );
    await this.revokeAll(account, ids, 'user_revoked');
    return ids.length;
  }

  private async revokeAll(
    account: UserRow,
    sessionIds: string[],
    reason: 'user_revoked',
  ): Promise<void> {
    if (sessionIds.length === 0) return;
    const now = this.ctx.now();
    const work = new UnitOfWork(this.ctx.deps.db);
    for (const id of sessionIds) {
      work.add(
        this.ctx.sessions.revoke(id, reason, now),
        this.ctx.audit.entry({
          action: 'auth.session.revoked',
          actorUserId: account.id,
          companyId: account.companyId,
          entityType: 'user_session',
          entityId: id,
          newValue: { reason },
        }),
      );
    }
    await work.commit();
  }
}

export function isActive(session: UserSessionRow, now: number): boolean {
  return (
    !session.revokedAt &&
    session.idleExpiresAt.getTime() > now &&
    session.absoluteExpiresAt.getTime() > now
  );
}
