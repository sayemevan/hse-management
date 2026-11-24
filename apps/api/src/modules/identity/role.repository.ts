import { and, countDistinct, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { type RoleCode, user, userRole, type UserRoleRow } from './identity.schema';

export interface NewRoleAssignment {
  id: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
  userId: string;
  roleCode: RoleCode;
  scopeLevel: UserRoleRow['scopeLevel'];
  companyId: string | null;
  projectId: string | null;
  createdBy: string | null;
}

/** The only code that reads or writes the `user_role` table. */
export class RoleRepository {
  constructor(private readonly db: Database) {}

  /** Role assignments currently in force (respects valid_from / valid_until). */
  async listActiveForUser(userId: string, now: number): Promise<UserRoleRow[]> {
    const at = new Date(now);
    return this.db
      .select()
      .from(userRole)
      .where(
        and(
          eq(userRole.userId, userId),
          or(isNull(userRole.validFrom), lte(userRole.validFrom, at)),
          or(isNull(userRole.validUntil), gt(userRole.validUntil, at)),
        ),
      )
      .all();
  }

  assign(assignment: NewRoleAssignment): Statement {
    return this.db.insert(userRole).values({ ...assignment, updatedBy: assignment.createdBy });
  }

  /** Every assignment of a user in a company, ended ones included (US-008 FR-1, T-34). */
  listAllForUser(userId: string, companyId: string): Promise<UserRoleRow[]> {
    return this.db
      .select()
      .from(userRole)
      .where(and(eq(userRole.userId, userId), eq(userRole.companyId, companyId)))
      .all();
  }

  findById(id: string): Promise<UserRoleRow | undefined> {
    return this.db.select().from(userRole).where(eq(userRole.id, id)).get();
  }

  /** Every project-role row of a project, ended ones included (US-022 FR-1). */
  listForProject(companyId: string, projectId: string): Promise<UserRoleRow[]> {
    return this.db
      .select()
      .from(userRole)
      .where(
        and(
          eq(userRole.companyId, companyId),
          eq(userRole.projectId, projectId),
          eq(userRole.scopeLevel, 'project'),
        ),
      )
      .all();
  }

  /** Company-scope rows in force for the given roles (US-022 "Company-wide access"). */
  listCompanyRolesInForce(
    companyId: string,
    roles: readonly RoleCode[],
    now: number,
  ): Promise<UserRoleRow[]> {
    const at = new Date(now);
    return this.db
      .select()
      .from(userRole)
      .where(
        and(
          eq(userRole.companyId, companyId),
          eq(userRole.scopeLevel, 'company'),
          inArray(userRole.roleCode, [...roles]),
          or(isNull(userRole.validFrom), lte(userRole.validFrom, at)),
          or(isNull(userRole.validUntil), gt(userRole.validUntil, at)),
        ),
      )
      .all();
  }

  /** T-34: rows are ended, never updated in place or deleted. */
  end(id: string, at: number, actorId: string): Statement {
    return this.db
      .update(userRole)
      .set({ validUntil: new Date(at), updatedAt: new Date(at), updatedBy: actorId })
      .where(eq(userRole.id, id));
  }

  /** O-24: active users other than `exceptUserId` holding Company Administrator now. */
  async countOtherActiveAdministrators(
    companyId: string,
    exceptUserId: string,
    now: number,
  ): Promise<number> {
    const at = new Date(now);
    const row = await this.db
      .select({ value: countDistinct(userRole.userId) })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .where(
        and(
          eq(userRole.companyId, companyId),
          eq(userRole.scopeLevel, 'company'),
          eq(userRole.roleCode, 'company_administrator'),
          ne(userRole.userId, exceptUserId),
          eq(user.status, 'active'),
          or(isNull(userRole.validFrom), lte(userRole.validFrom, at)),
          or(isNull(userRole.validUntil), gt(userRole.validUntil, at)),
        ),
      )
      .get();
    return row?.value ?? 0;
  }

  /** US-009 FR-1: active users holding each role (company or project) now. */
  async userCountsByRole(companyId: string, now: number): Promise<Map<RoleCode, number>> {
    const at = new Date(now);
    const rows = await this.db
      .select({
        roleCode: userRole.roleCode,
        value: sql<number>`count(distinct ${userRole.userId})`,
      })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .where(
        and(
          eq(userRole.companyId, companyId),
          eq(user.status, 'active'),
          or(isNull(userRole.validFrom), lte(userRole.validFrom, at)),
          or(isNull(userRole.validUntil), gt(userRole.validUntil, at)),
        ),
      )
      .groupBy(userRole.roleCode)
      .all();
    return new Map(rows.map((row) => [row.roleCode, row.value]));
  }

  /** Number of project roles in force or scheduled per user (users list). */
  async projectRoleCounts(userIds: readonly string[], now: number): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const at = new Date(now);
    const rows = await this.db
      .select({ userId: userRole.userId, value: sql<number>`count(*)` })
      .from(userRole)
      .where(
        and(
          sql`${userRole.userId} in (${sql.join(
            userIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
          eq(userRole.scopeLevel, 'project'),
          or(isNull(userRole.validUntil), gt(userRole.validUntil, at)),
        ),
      )
      .groupBy(userRole.userId)
      .all();
    return new Map(rows.map((row) => [row.userId, row.value]));
  }
}
