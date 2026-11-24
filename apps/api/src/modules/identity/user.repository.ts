import type { Language } from '@hse/shared';
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import type { TenantContext } from '../../core/context/tenant';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import {
  type RoleCode,
  user,
  userInvitation,
  type UserInvitationRow,
  userRole,
  type UserRow,
  type UserStatus,
} from './identity.schema';

export interface ProfileUpdate {
  fullName?: string;
  phone?: string | null;
  preferredLanguage?: Language | null;
  timeZone?: string | null;
}

export interface NewInvitedUser {
  id: string;
  companyId: string;
  email: string;
  fullName: string;
  language: Language;
  invitedBy: string;
}

export interface CompanyUserRow {
  user: UserRow;
  invitation: UserInvitationRow | null;
  /** The company role in force (US-008: one per user). */
  roleCodes: RoleCode[];
  /** Project roles in force or scheduled. */
  projectCount: number;
}

/** Never a valid hash, so pending users can't sign in until they accept (T-15). */
export const NO_PASSWORD = '!';

/** Users that take a seat in the plan (O-26). */
const SEAT_STATUSES: UserStatus[] = ['active', 'pending_invitation', 'locked', 'suspended'];

function likePattern(search: string): string {
  return `%${search.toLowerCase().replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
}

export interface LoginSuccessUpdate {
  now: number;
  /** Set when the stored hash used weaker parameters and was upgraded. */
  newPasswordHash?: string;
}

/** The only code that reads or writes the `user` table. Archived (soft-deleted) rows are excluded. */
export class UserRepository {
  constructor(private readonly db: Database) {}

  /**
   * Finds a sign-in candidate within the request's tenant (PLT-02): a company subdomain only
   * sees that company's users; the platform (base domain) only sees platform users (O-3).
   */
  async findByEmailInTenant(email: string, tenant: TenantContext): Promise<UserRow | undefined> {
    const tenantFilter =
      tenant.kind === 'company' ? eq(user.companyId, tenant.company.id) : isNull(user.companyId);
    return this.db
      .select()
      .from(user)
      .where(and(eq(user.email, email), tenantFilter, isNull(user.deletedAt)))
      .get();
  }

  /** Display names for a set of users (other modules show who did what). */
  async namesByIds(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: user.id, fullName: user.fullName })
      .from(user)
      .where(inArray(user.id, [...new Set(ids)]))
      .all();
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }

  async findById(id: string): Promise<UserRow | undefined> {
    return this.db
      .select()
      .from(user)
      .where(and(eq(user.id, id), isNull(user.deletedAt)))
      .get();
  }

  recordFailedAttempt(
    userId: string,
    failedLoginCount: number,
    lockedUntil: number | null,
  ): Statement {
    return this.db
      .update(user)
      .set({
        failedLoginCount,
        lockedUntil: lockedUntil === null ? null : new Date(lockedUntil),
      })
      .where(eq(user.id, userId));
  }

  recordSuccessfulLogin(userId: string, update: LoginSuccessUpdate): Statement {
    return this.db
      .update(user)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(update.now),
        ...(update.newPasswordHash
          ? {
              passwordHash: update.newPasswordHash,
              updatedAt: new Date(update.now),
              updatedBy: userId,
            }
          : {}),
      })
      .where(eq(user.id, userId));
  }

  changePassword(userId: string, passwordHash: string, now: number): Statement {
    return this.db
      .update(user)
      .set({
        passwordHash,
        passwordChangedAt: new Date(now),
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(now),
        updatedBy: userId,
      })
      .where(eq(user.id, userId));
  }

  /** A user of this company (not archived). */
  async findInCompany(id: string, companyId: string): Promise<UserRow | undefined> {
    return this.db
      .select()
      .from(user)
      .where(and(eq(user.id, id), eq(user.companyId, companyId), isNull(user.deletedAt)))
      .get();
  }

  /** Users counted against the plan limit (O-26). */
  async countSeats(companyId: string): Promise<number> {
    const row = await this.db
      .select({ value: count() })
      .from(user)
      .where(
        and(
          eq(user.companyId, companyId),
          isNull(user.deletedAt),
          inArray(user.status, SEAT_STATUSES),
        ),
      )
      .get();
    return row?.value ?? 0;
  }

  /** US-006 FR-9: the company's users, newest first, with any open invitation and their roles. */
  async listForCompany(
    companyId: string,
    search: string | undefined,
    page: { limit: number; offset: number },
  ): Promise<{ rows: CompanyUserRow[]; total: number }> {
    const pattern = search ? likePattern(search) : null;
    const filter = and(
      eq(user.companyId, companyId),
      isNull(user.deletedAt),
      pattern
        ? or(
            sql`lower(${user.fullName}) like ${pattern} escape '\\'`,
            sql`${user.email} like ${pattern} escape '\\'`,
          )
        : undefined,
    );
    const [totalRow, rows] = await Promise.all([
      this.db.select({ value: count() }).from(user).where(filter).get(),
      this.db
        .select({ user, invitation: userInvitation })
        .from(user)
        .leftJoin(
          userInvitation,
          and(
            eq(userInvitation.userId, user.id),
            isNull(userInvitation.acceptedAt),
            isNull(userInvitation.revokedAt),
          ),
        )
        .where(filter)
        .orderBy(desc(user.createdAt))
        .limit(page.limit)
        .offset(page.offset)
        .all(),
    ]);
    const ids = rows.map((row) => row.user.id);
    const roles =
      ids.length === 0
        ? []
        : await this.db
            .select({
              userId: userRole.userId,
              roleCode: userRole.roleCode,
              scopeLevel: userRole.scopeLevel,
            })
            .from(userRole)
            .where(
              and(
                inArray(userRole.userId, ids),
                eq(userRole.companyId, companyId),
                or(isNull(userRole.validUntil), gt(userRole.validUntil, new Date())),
              ),
            )
            .all();
    return {
      total: totalRow?.value ?? 0,
      rows: rows.map((row) => ({
        ...row,
        roleCodes: roles
          .filter((role) => role.userId === row.user.id && role.scopeLevel === 'company')
          .map((role) => role.roleCode),
        projectCount: roles.filter(
          (role) => role.userId === row.user.id && role.scopeLevel === 'project',
        ).length,
      })),
    };
  }

  createInvited(input: NewInvitedUser): Statement {
    return this.db.insert(user).values({
      id: input.id,
      companyId: input.companyId,
      email: input.email,
      fullName: input.fullName,
      passwordHash: NO_PASSWORD,
      status: 'pending_invitation',
      preferredLanguage: input.language,
      createdBy: input.invitedBy,
      updatedBy: input.invitedBy,
    });
  }

  /** US-006 FR-7: only a still-pending user is activated. */
  activateInvited(userId: string, passwordHash: string, now: number): Statement {
    return this.db
      .update(user)
      .set({
        passwordHash,
        passwordChangedAt: new Date(now),
        status: 'active',
        updatedAt: new Date(now),
        updatedBy: userId,
      })
      .where(and(eq(user.id, userId), eq(user.status, 'pending_invitation')));
  }

  /**
   * Archives a pending user whose invitation was cancelled (US-006 FR-6). The email column is
   * unique across archived rows too (D-08), so it gets a suffix to free the address.
   */
  archiveInvited(userId: string, actorId: string, now: number): Statement {
    return this.db
      .update(user)
      .set({
        status: 'archived',
        email: sql`${user.email} || '#cancelled-' || ${now}`,
        deletedAt: new Date(now),
        deletedBy: actorId,
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(and(eq(user.id, userId), eq(user.status, 'pending_invitation')));
  }

  updateProfile(userId: string, fields: ProfileUpdate, now: number): Statement {
    return this.db
      .update(user)
      .set({ ...fields, updatedAt: new Date(now), updatedBy: userId })
      .where(eq(user.id, userId));
  }

  setPreferredLanguage(userId: string, language: Language, now: number): Statement {
    return this.db
      .update(user)
      .set({ preferredLanguage: language, updatedAt: new Date(now), updatedBy: userId })
      .where(eq(user.id, userId));
  }
}
