import type { CurrentUserDto } from '@hse/shared';
import { generateId } from '@hse/shared';

import { PasswordHasher } from '../../core/auth/password-hasher';
import type { TokenService } from '../../core/auth/token-service';
import { describeDevice } from '../../core/http/request-meta';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { TenantAccessDeniedError } from '../company';
import { belongsToTenant, type IdentityContext } from './identity.context';
import {
  AccountInactiveError,
  AccountTemporarilyLockedError,
  InvalidCredentialsError,
  SessionExpiredError,
} from './identity.errors';
import type { UserRow, UserSessionRow } from './identity.schema';
import { LoginProtection } from './login-protection';
import { generateRefreshToken, hashRefreshToken } from './refresh-token';
import { buildCurrentUser } from './user.mapper';

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  /** Absent when an access token was re-issued without rotating (parallel refresh). */
  refreshToken?: string;
  sessionAbsoluteExpiresAt: number;
}

export interface LoginResult extends IssuedTokens {
  refreshToken: string;
  user: CurrentUserDto;
}

// A fixed hash so unknown accounts take as long to reject as known ones (no user enumeration).
const dummyHashes = new Map<number, Promise<string>>();
function dummyHashFor(hasher: PasswordHasher, iterations: number): Promise<string> {
  let hash = dummyHashes.get(iterations);
  if (!hash) {
    hash = hasher.hash('timing-equaliser-not-a-real-password');
    dummyHashes.set(iterations, hash);
  }
  return hash;
}

/** Sign-in, token refresh and sign-out (US-001, US-004). */
export class AuthService {
  private readonly hasher: PasswordHasher;
  private readonly protection: LoginProtection;

  constructor(
    private readonly ctx: IdentityContext,
    private readonly tokens: TokenService,
  ) {
    const { security } = ctx.deps.config;
    this.hasher = new PasswordHasher(security.passwordHashIterations);
    this.protection = new LoginProtection(security, ctx.users, ctx.audit, ctx.deps.db);
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const { tenant, config } = this.ctx.deps;
    const now = this.ctx.now();
    const account = await this.ctx.users.findByEmailInTenant(email, tenant);

    if (!account) {
      await this.hasher.verify(
        password,
        await dummyHashFor(this.hasher, config.security.passwordHashIterations),
      );
      await this.ctx.audit.record({
        action: 'auth.login.failed',
        actorUserId: null,
        companyId: tenant.kind === 'company' ? tenant.company.id : null,
        outcome: 'failure',
        newValue: { reason: 'unknown_account' },
      });
      throw new InvalidCredentialsError();
    }

    const verification = await this.hasher.verify(password, account.passwordHash);
    const lockMinutes = this.protection.remainingLockMinutes(account, now);

    if (lockMinutes !== null) {
      await this.ctx.audit.record({
        action: 'auth.login.failed',
        actorUserId: account.id,
        companyId: account.companyId,
        entityType: 'user',
        entityId: account.id,
        outcome: 'failure',
        newValue: { reason: 'temporarily_locked', email: account.email },
      });
      // O-1: reveal the lock only to someone who knows the password.
      if (verification.valid) throw new AccountTemporarilyLockedError(lockMinutes);
      throw new InvalidCredentialsError();
    }

    if (!verification.valid) {
      const outcome = await this.protection.recordFailure(account, now, 'wrong_password');
      await new UnitOfWork(this.ctx.deps.db).add(...outcome.statements).commit();
      throw new InvalidCredentialsError();
    }

    if (account.status !== 'active') {
      await this.ctx.audit.record({
        action: 'auth.login.failed',
        actorUserId: account.id,
        companyId: account.companyId,
        entityType: 'user',
        entityId: account.id,
        outcome: 'failure',
        newValue: { reason: `status_${account.status}`, email: account.email },
      });
      throw new AccountInactiveError();
    }

    const newPasswordHash = verification.needsRehash ? await this.hasher.hash(password) : undefined;
    return this.signIn(account, now, [], newPasswordHash);
  }

  /**
   * Starts a session for an account that has just proved who it is, committing `statements`
   * in the same batch (US-001; US-006 FR-7 signs the user in when they accept an invitation).
   * `account` must already reflect the state after `statements`.
   */
  async signIn(
    account: UserRow,
    now: number,
    statements: Statement[],
    newPasswordHash?: string,
  ): Promise<LoginResult> {
    const {
      session,
      refreshToken,
      statements: sessionStatements,
    } = await this.newSession(account, now);

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        ...statements,
        ...sessionStatements,
        this.ctx.users.recordSuccessfulLogin(account.id, {
          now,
          ...(newPasswordHash ? { newPasswordHash } : {}),
        }),
        this.ctx.audit.entry({
          action: 'auth.login.succeeded',
          actorUserId: account.id,
          companyId: account.companyId,
          entityType: 'user',
          entityId: account.id,
          newValue: {
            sessionId: session.id,
            device: session.deviceLabel,
            browser: session.browser,
          },
        }),
      )
      .commit();

    const access = await this.tokens.issueAccessToken({
      userId: account.id,
      sessionId: session.id,
    });
    const roles = await this.ctx.roles.listActiveForUser(account.id, now);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      sessionAbsoluteExpiresAt: session.absoluteExpiresAt,
      user: await buildCurrentUser(this.ctx, { ...account, lastLoginAt: new Date(now) }, roles),
    };
  }

  /**
   * Exchanges a refresh token for a new access token and rotates the refresh token (US-001 FR-7).
   * Re-use of an already-rotated token outside the grace window revokes the whole session.
   */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const now = this.ctx.now();
    const { session: sessionConfig } = this.ctx.deps.config;
    const hash = await hashRefreshToken(refreshToken);

    const current = await this.ctx.sessions.findWithUserByRefreshHash(hash);
    if (!current) return this.handleRotatedToken(hash, now);

    this.assertUsable(current.session, current.user, now);

    const nextToken = generateRefreshToken();
    const idleExpiresAt = now + sessionConfig.idleTimeoutSeconds * 1000;
    const changed = await this.ctx.sessions.rotateRefreshToken(
      current.session.id,
      hash,
      await hashRefreshToken(nextToken),
      now,
      idleExpiresAt,
    );

    const access = await this.tokens.issueAccessToken({
      userId: current.user.id,
      sessionId: current.session.id,
    });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      // Another request rotated first: keep the cookie it set.
      ...(changed === 1 ? { refreshToken: nextToken } : {}),
      sessionAbsoluteExpiresAt: current.session.absoluteExpiresAt.getTime(),
    };
  }

  /** Ends the session identified by the refresh cookie. Always succeeds (idempotent, US-004). */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const now = this.ctx.now();
    const found = await this.ctx.sessions.findWithUserByRefreshHash(
      await hashRefreshToken(refreshToken),
    );
    if (!found || found.session.revokedAt) return;

    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.sessions.revoke(found.session.id, 'logout', now),
        this.ctx.audit.entry({
          action: 'auth.logout',
          actorUserId: found.user.id,
          companyId: found.user.companyId,
          entityType: 'user_session',
          entityId: found.session.id,
        }),
      )
      .commit();
  }

  private async handleRotatedToken(hash: string, now: number): Promise<IssuedTokens> {
    const previous = await this.ctx.sessions.findWithUserByPreviousRefreshHash(hash);
    if (!previous || previous.session.revokedAt) throw new SessionExpiredError();

    const graceMs = this.ctx.deps.config.session.refreshReuseGraceSeconds * 1000;
    const rotatedAt = previous.session.refreshRotatedAt?.getTime() ?? 0;

    if (now - rotatedAt <= graceMs) {
      // Parallel refresh from another tab: issue an access token, leave the cookie alone.
      this.assertUsable(previous.session, previous.user, now);
      const access = await this.tokens.issueAccessToken({
        userId: previous.user.id,
        sessionId: previous.session.id,
      });
      return {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        sessionAbsoluteExpiresAt: previous.session.absoluteExpiresAt.getTime(),
      };
    }

    // An old token came back long after rotation: assume it was stolen.
    await new UnitOfWork(this.ctx.deps.db)
      .add(
        this.ctx.sessions.revoke(previous.session.id, 'token_reuse', now),
        this.ctx.audit.entry({
          action: 'auth.token.reuse_detected',
          actorUserId: previous.user.id,
          companyId: previous.user.companyId,
          entityType: 'user_session',
          entityId: previous.session.id,
          outcome: 'failure',
        }),
      )
      .commit();
    this.ctx.deps.logger.warn('refresh token reuse detected', { sessionId: previous.session.id });
    throw new SessionExpiredError();
  }

  private assertUsable(session: UserSessionRow, account: UserRow, now: number): void {
    if (
      session.revokedAt ||
      session.idleExpiresAt.getTime() <= now ||
      session.absoluteExpiresAt.getTime() <= now ||
      account.status !== 'active' ||
      account.deletedAt
    ) {
      throw new SessionExpiredError();
    }
    if (!belongsToTenant(account, this.ctx.deps.tenant)) throw new TenantAccessDeniedError();
  }

  private async newSession(account: UserRow, now: number) {
    const { session: sessionConfig } = this.ctx.deps.config;
    const refreshToken = generateRefreshToken();
    const device = describeDevice(this.ctx.deps.meta.userAgent);
    const session = {
      id: generateId(),
      userId: account.id,
      refreshTokenHash: await hashRefreshToken(refreshToken),
      deviceLabel: device.deviceLabel,
      browser: device.browser,
      ipAddress: this.ctx.deps.meta.ipAddress,
      now,
      idleExpiresAt: now + sessionConfig.idleTimeoutSeconds * 1000,
      absoluteExpiresAt: now + sessionConfig.absoluteLifetimeSeconds * 1000,
    };
    return { session, refreshToken, statements: [this.ctx.sessions.create(session)] };
  }
}
