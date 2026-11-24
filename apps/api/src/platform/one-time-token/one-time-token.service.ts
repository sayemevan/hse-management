import { generateId } from '@hse/shared';
import { and, count, eq, gte, inArray, isNull } from 'drizzle-orm';

import { generateSecureToken, sha256Hex } from '../../core/security/secure-token';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { oneTimeToken, type OneTimeTokenRow, type TokenPurpose } from './one-time-token.schema';

export interface IssuedToken {
  /** The raw token: put it in a link, never store it. */
  token: string;
  statement: Statement;
}

/**
 * Single-use, expiring tokens for email links (T-10). Only hashes are stored; a token is
 * consumed inside the same batch as the change it authorises.
 */
export class OneTimeTokenService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  async issue(purpose: TokenPurpose, subjectId: string, ttlMs: number): Promise<IssuedToken> {
    const token = generateSecureToken();
    const now = this.clock();
    const statement = this.db.insert(oneTimeToken).values({
      id: generateId(),
      purpose,
      subjectId,
      tokenHash: await sha256Hex(token),
      expiresAt: new Date(now + ttlMs),
      createdAt: new Date(now),
    });
    return { token, statement };
  }

  /** The token row for this raw token and purpose, used or not. */
  async find(purpose: TokenPurpose, token: string): Promise<OneTimeTokenRow | undefined> {
    return this.db
      .select()
      .from(oneTimeToken)
      .where(
        and(eq(oneTimeToken.purpose, purpose), eq(oneTimeToken.tokenHash, await sha256Hex(token))),
      )
      .get();
  }

  isUsable(row: OneTimeTokenRow): boolean {
    return row.usedAt === null && row.expiresAt.getTime() > this.clock();
  }

  /** Marks the token used. Combine with the business change in one UnitOfWork. */
  consume(row: OneTimeTokenRow): Statement {
    return this.db
      .update(oneTimeToken)
      .set({ usedAt: new Date(this.clock()) })
      .where(and(eq(oneTimeToken.id, row.id), isNull(oneTimeToken.usedAt)));
  }

  /** Invalidates every unused token of this purpose for the subject (e.g. on resend). */
  invalidateAll(purpose: TokenPurpose, subjectId: string): Statement {
    return this.db
      .update(oneTimeToken)
      .set({ usedAt: new Date(this.clock()) })
      .where(
        and(
          eq(oneTimeToken.purpose, purpose),
          eq(oneTimeToken.subjectId, subjectId),
          isNull(oneTimeToken.usedAt),
        ),
      );
  }

  async countIssuedSince(purpose: TokenPurpose, subjectId: string, since: number): Promise<number> {
    const row = await this.db
      .select({ value: count() })
      .from(oneTimeToken)
      .where(
        and(
          eq(oneTimeToken.purpose, purpose),
          eq(oneTimeToken.subjectId, subjectId),
          gte(oneTimeToken.createdAt, new Date(since)),
        ),
      )
      .get();
    return row?.value ?? 0;
  }

  /** Deletes all tokens of the given subjects (when the subject itself is removed). */
  deleteForSubjects(subjectIds: string[]): Statement {
    return this.db.delete(oneTimeToken).where(inArray(oneTimeToken.subjectId, subjectIds));
  }
}
