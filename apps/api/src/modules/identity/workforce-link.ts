import { and, asc, eq, inArray, isNull, like, or } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { user } from './identity.schema';

/**
 * The optional link between a user and a workforce profile (D-09, T-53). The column lives on
 * `user`, so only identity writes it; the workforce module asks through this class.
 * One profile per user and one user per profile (unique index).
 */
export class WorkforceUserLinks {
  constructor(private readonly db: Database) {}

  /** The profile linked to a user of the company, if any. */
  async memberOf(userId: string, companyId: string): Promise<string | null> {
    const row = await this.db
      .select({ memberId: user.workforceMemberId })
      .from(user)
      .where(and(eq(user.id, userId), eq(user.companyId, companyId), isNull(user.deletedAt)))
      .get();
    return row?.memberId ?? null;
  }

  /** Linked users per profile: id, name and whether the account is active. */
  async usersOf(
    companyId: string,
    memberIds: readonly string[],
  ): Promise<Map<string, { id: string; fullName: string; active: boolean }>> {
    if (memberIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: user.id,
        fullName: user.fullName,
        status: user.status,
        memberId: user.workforceMemberId,
      })
      .from(user)
      .where(
        and(
          eq(user.companyId, companyId),
          inArray(user.workforceMemberId, [...new Set(memberIds)]),
          isNull(user.deletedAt),
        ),
      )
      .all();
    return new Map(
      rows.flatMap((row) =>
        row.memberId
          ? [
              [
                row.memberId,
                { id: row.id, fullName: row.fullName, active: row.status === 'active' },
              ],
            ]
          : [],
      ),
    );
  }

  /** A user that may be linked: in the company, not removed (System Owners have no company). */
  async find(
    companyId: string,
    userId: string,
  ): Promise<{ id: string; fullName: string; memberId: string | null } | undefined> {
    return this.db
      .select({ id: user.id, fullName: user.fullName, memberId: user.workforceMemberId })
      .from(user)
      .where(and(eq(user.id, userId), eq(user.companyId, companyId), isNull(user.deletedAt)))
      .get();
  }

  /** Users not yet linked, for the Link account picker (US-024 flow 4). */
  async candidates(
    companyId: string,
    search: string | undefined,
  ): Promise<{ id: string; fullName: string; email: string }[]> {
    const conditions = [
      eq(user.companyId, companyId),
      isNull(user.deletedAt),
      isNull(user.workforceMemberId),
      inArray(user.status, ['active', 'pending_invitation']),
    ];
    if (search) {
      const pattern = `%${search.replace(/[%_]/g, '')}%`;
      const match = or(like(user.fullName, pattern), like(user.email, pattern));
      if (match) conditions.push(match);
    }
    return this.db
      .select({ id: user.id, fullName: user.fullName, email: user.email })
      .from(user)
      .where(and(...conditions))
      .orderBy(asc(user.fullName))
      .limit(25)
      .all();
  }

  link(userId: string, memberId: string, actorId: string, now: number): Statement {
    return this.db
      .update(user)
      .set({ workforceMemberId: memberId, updatedAt: new Date(now), updatedBy: actorId })
      .where(eq(user.id, userId));
  }

  /** Removes whatever user is linked to the profile (unlink, archive). */
  unlinkMember(memberId: string, actorId: string, now: number): Statement {
    return this.db
      .update(user)
      .set({ workforceMemberId: null, updatedAt: new Date(now), updatedBy: actorId })
      .where(eq(user.workforceMemberId, memberId));
  }
}
