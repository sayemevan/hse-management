import type { Language } from '@hse/shared';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { type RoleCode, userInvitation, type UserInvitationRow } from './identity.schema';

export interface NewInvitation {
  id: string;
  companyId: string;
  userId: string;
  invitedBy: string;
  roleCode: RoleCode;
  language: Language;
  now: number;
  expiresAt: number;
}

/** The only code that reads or writes `user_invitation` (US-006). */
export class InvitationRepository {
  constructor(private readonly db: Database) {}

  create(input: NewInvitation): Statement {
    const now = new Date(input.now);
    return this.db.insert(userInvitation).values({
      id: input.id,
      companyId: input.companyId,
      userId: input.userId,
      invitedBy: input.invitedBy,
      roleCode: input.roleCode,
      language: input.language,
      sentAt: now,
      lastSentAt: now,
      expiresAt: new Date(input.expiresAt),
      createdBy: input.invitedBy,
      updatedBy: input.invitedBy,
    });
  }

  /** US-008 FR-2: a pending invitation follows the user's new company role. */
  setRole(id: string, roleCode: RoleCode, actorId: string, now: number): Statement {
    return this.db
      .update(userInvitation)
      .set({ roleCode, updatedAt: new Date(now), updatedBy: actorId })
      .where(eq(userInvitation.id, id));
  }

  /** The invitation still waiting for this user, if any. */
  async findOpenForUser(userId: string): Promise<UserInvitationRow | undefined> {
    return this.db
      .select()
      .from(userInvitation)
      .where(
        and(
          eq(userInvitation.userId, userId),
          isNull(userInvitation.acceptedAt),
          isNull(userInvitation.revokedAt),
        ),
      )
      .get();
  }

  markResent(
    id: string,
    actorId: string,
    now: number,
    expiresAt: number,
    resendCount: number,
  ): Statement {
    return this.db
      .update(userInvitation)
      .set({
        lastSentAt: new Date(now),
        expiresAt: new Date(expiresAt),
        resendCount,
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(eq(userInvitation.id, id));
  }

  markAccepted(id: string, userId: string, now: number): Statement {
    return this.db
      .update(userInvitation)
      .set({ acceptedAt: new Date(now), updatedAt: new Date(now), updatedBy: userId })
      .where(and(eq(userInvitation.id, id), isNull(userInvitation.acceptedAt)));
  }

  revoke(id: string, actorId: string, now: number): Statement {
    return this.db
      .update(userInvitation)
      .set({
        revokedAt: new Date(now),
        revokedBy: actorId,
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(and(eq(userInvitation.id, id), isNull(userInvitation.revokedAt)));
  }
}
