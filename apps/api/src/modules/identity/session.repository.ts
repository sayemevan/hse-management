import { and, desc, eq, gt, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import {
  type SessionRevokeReason,
  user,
  type UserRow,
  userSession,
  type UserSessionRow,
} from './identity.schema';

export interface NewSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  deviceLabel: string;
  browser: string;
  ipAddress: string | null;
  now: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
}

export interface SessionWithUser {
  session: UserSessionRow;
  user: UserRow;
}

/** The only code that reads or writes the `user_session` table. */
export class SessionRepository {
  constructor(private readonly db: Database) {}

  create(session: NewSession): Statement {
    return this.db.insert(userSession).values({
      id: session.id,
      userId: session.userId,
      refreshTokenHash: session.refreshTokenHash,
      deviceLabel: session.deviceLabel,
      browser: session.browser,
      ipAddress: session.ipAddress,
      createdAt: new Date(session.now),
      lastActivityAt: new Date(session.now),
      idleExpiresAt: new Date(session.idleExpiresAt),
      absoluteExpiresAt: new Date(session.absoluteExpiresAt),
    });
  }

  async findWithUser(sessionId: string): Promise<SessionWithUser | undefined> {
    return this.db
      .select({ session: userSession, user })
      .from(userSession)
      .innerJoin(user, eq(user.id, userSession.userId))
      .where(eq(userSession.id, sessionId))
      .get();
  }

  async findWithUserByRefreshHash(hash: string): Promise<SessionWithUser | undefined> {
    return this.db
      .select({ session: userSession, user })
      .from(userSession)
      .innerJoin(user, eq(user.id, userSession.userId))
      .where(eq(userSession.refreshTokenHash, hash))
      .get();
  }

  async findWithUserByPreviousRefreshHash(hash: string): Promise<SessionWithUser | undefined> {
    return this.db
      .select({ session: userSession, user })
      .from(userSession)
      .innerJoin(user, eq(user.id, userSession.userId))
      .where(eq(userSession.previousRefreshTokenHash, hash))
      .get();
  }

  /** Sessions that are not revoked and not expired, most recent activity first. */
  async listActiveForUser(userId: string, now: number): Promise<UserSessionRow[]> {
    const at = new Date(now);
    return this.db
      .select()
      .from(userSession)
      .where(
        and(
          eq(userSession.userId, userId),
          isNull(userSession.revokedAt),
          gt(userSession.idleExpiresAt, at),
          gt(userSession.absoluteExpiresAt, at),
        ),
      )
      .orderBy(desc(userSession.lastActivityAt))
      .all();
  }

  async findForUser(sessionId: string, userId: string): Promise<UserSessionRow | undefined> {
    return this.db
      .select()
      .from(userSession)
      .where(and(eq(userSession.id, sessionId), eq(userSession.userId, userId)))
      .get();
  }

  /** Every session that could still be used (password reset ends them all, T-21). */
  async listActiveIds(userId: string, now: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: userSession.id })
      .from(userSession)
      .where(
        and(
          eq(userSession.userId, userId),
          isNull(userSession.revokedAt),
          gt(userSession.absoluteExpiresAt, new Date(now)),
        ),
      )
      .all();
    return rows.map((row) => row.id);
  }

  async listActiveIdsExcept(userId: string, keepSessionId: string, now: number): Promise<string[]> {
    const at = new Date(now);
    const rows = await this.db
      .select({ id: userSession.id })
      .from(userSession)
      .where(
        and(
          eq(userSession.userId, userId),
          ne(userSession.id, keepSessionId),
          isNull(userSession.revokedAt),
          gt(userSession.absoluteExpiresAt, at),
        ),
      )
      .all();
    return rows.map((row) => row.id);
  }

  /**
   * Rotates the refresh token only if it is still the current one, so two parallel
   * refreshes cannot both rotate. Returns the number of rows changed (0 or 1).
   */
  async rotateRefreshToken(
    sessionId: string,
    currentHash: string,
    nextHash: string,
    now: number,
    idleExpiresAt: number,
  ): Promise<number> {
    const result = await this.db
      .update(userSession)
      .set({
        previousRefreshTokenHash: currentHash,
        refreshTokenHash: nextHash,
        refreshRotatedAt: new Date(now),
        lastActivityAt: new Date(now),
        idleExpiresAt: new Date(idleExpiresAt),
      })
      .where(and(eq(userSession.id, sessionId), eq(userSession.refreshTokenHash, currentHash)))
      .run();
    return result.meta.changes;
  }

  touch(sessionId: string, now: number, idleExpiresAt: number): Statement {
    return this.db
      .update(userSession)
      .set({ lastActivityAt: new Date(now), idleExpiresAt: new Date(idleExpiresAt) })
      .where(eq(userSession.id, sessionId));
  }

  /**
   * Removes refresh-token hashes from sessions that can never be used again (revoked or
   * expired). The rows stay for history (US-010 FR-5). Returns the number of rows cleaned.
   */
  async purgeEndedTokenHashes(now: number): Promise<number> {
    const at = new Date(now);
    const result = await this.db
      .update(userSession)
      .set({ refreshTokenHash: null, previousRefreshTokenHash: null })
      .where(
        and(
          or(
            isNotNull(userSession.refreshTokenHash),
            isNotNull(userSession.previousRefreshTokenHash),
          ),
          or(
            isNotNull(userSession.revokedAt),
            lte(userSession.idleExpiresAt, at),
            lte(userSession.absoluteExpiresAt, at),
          ),
        ),
      )
      .run();
    return result.meta.changes;
  }

  /** Revokes a session. Already-revoked sessions keep their original reason. */
  revoke(sessionId: string, reason: SessionRevokeReason, now: number): Statement {
    return this.db
      .update(userSession)
      .set({ revokedAt: new Date(now), revokedReason: reason })
      .where(and(eq(userSession.id, sessionId), isNull(userSession.revokedAt)));
  }
}
