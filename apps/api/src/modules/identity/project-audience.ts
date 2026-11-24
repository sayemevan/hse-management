import { COMPANY_WIDE_ROLES } from '@hse/shared';
import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { company } from '../company';
import { type RoleCode, user, userRole } from './identity.schema';
import type { PermissionResolver } from './permission-matrix';

/**
 * Who is concerned by a change (PLT-17 FR-3). Only `active` users, and only roles in force
 * now. "Members" of a project = its project roles in force plus the company-wide roles (O-45).
 */
export class ProjectAudience {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  private inForce() {
    const at = new Date(this.clock());
    return and(
      or(isNull(userRole.validFrom), lte(userRole.validFrom, at)),
      or(isNull(userRole.validUntil), gt(userRole.validUntil, at)),
    );
  }

  /** Project roles in force on a project: user and role. */
  async projectRoles(
    companyId: string,
    projectId: string,
  ): Promise<{ userId: string; roleCode: RoleCode }[]> {
    return this.db
      .select({ userId: userRole.userId, roleCode: userRole.roleCode })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .where(
        and(
          eq(userRole.companyId, companyId),
          eq(userRole.projectId, projectId),
          eq(userRole.scopeLevel, 'project'),
          eq(user.status, 'active'),
          this.inForce(),
        ),
      )
      .all();
  }

  /** Active users whose company role in force is one of `roles`. */
  async companyRoleHolders(companyId: string, roles: readonly RoleCode[]): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ userId: userRole.userId })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .where(
        and(
          eq(userRole.companyId, companyId),
          eq(userRole.scopeLevel, 'company'),
          inArray(userRole.roleCode, [...roles]),
          eq(user.status, 'active'),
          this.inForce(),
        ),
      )
      .all();
    return rows.map((row) => row.userId);
  }

  /** PLT-17 "Members": project roles in force plus company-wide roles. */
  async members(companyId: string, projectId: string): Promise<string[]> {
    const [project, wide] = await Promise.all([
      this.projectRoles(companyId, projectId),
      this.companyRoleHolders(companyId, COMPANY_WIDE_ROLES),
    ]);
    return [...new Set([...project.map((row) => row.userId), ...wide])];
  }

  /**
   * `project.member.joined` recipients: the project's Project Managers and the other holders
   * of `projects.members.manage` through a project role.
   */
  async memberManagers(
    companyId: string,
    projectId: string,
    resolver: PermissionResolver,
  ): Promise<string[]> {
    const result = new Set<string>();
    for (const row of await this.projectRoles(companyId, projectId)) {
      if (
        row.roleCode === 'project_manager' ||
        (await resolver.roleGrants(companyId, row.roleCode)).has('projects.members.manage')
      ) {
        result.add(row.userId);
      }
    }
    return [...result];
  }

  /** Active users whose company role in force grants a company-scope permission. */
  async companyPermissionHolders(
    companyId: string,
    permission: string,
    resolver: PermissionResolver,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ userId: userRole.userId, roleCode: userRole.roleCode })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .where(
        and(
          eq(userRole.companyId, companyId),
          eq(userRole.scopeLevel, 'company'),
          eq(user.status, 'active'),
          this.inForce(),
        ),
      )
      .all();
    const result = new Set<string>();
    for (const row of rows) {
      if ((await resolver.roleGrants(companyId, row.roleCode)).has(permission)) {
        result.add(row.userId);
      }
    }
    return [...result];
  }

  /**
   * Active users holding a project-scope permission on a project: through a project role in
   * force there, or through a company-wide role (O-45).
   */
  async projectPermissionHolders(
    companyId: string,
    projectId: string,
    permission: string,
    resolver: PermissionResolver,
  ): Promise<string[]> {
    const result = new Set<string>();
    for (const row of await this.projectRoles(companyId, projectId)) {
      if ((await resolver.roleGrants(companyId, row.roleCode)).has(permission)) {
        result.add(row.userId);
      }
    }
    for (const role of COMPANY_WIDE_ROLES) {
      if (!(await resolver.roleGrants(companyId, role)).has(permission)) continue;
      for (const userId of await this.companyRoleHolders(companyId, [role])) result.add(userId);
    }
    return [...result];
  }

  /** PLT-19 FR-6: members in force (project roles plus company-wide roles). */
  async memberCount(companyId: string, projectId: string): Promise<number> {
    return (await this.members(companyId, projectId)).length;
  }

  /**
   * Dated project roles whose end falls in (from, to], that were given with that end date
   * (not ended early by a removal or a change, which set `valid_until` = `updated_at`).
   */
  async projectRolesEndingBetween(
    from: number,
    to: number,
  ): Promise<
    {
      id: string;
      userId: string;
      companyId: string;
      projectId: string;
      roleCode: RoleCode;
      validUntil: Date;
      createdBy: string | null;
      fullName: string;
      timeZone: string;
    }[]
  > {
    const rows = await this.db
      .select({
        id: userRole.id,
        userId: userRole.userId,
        companyId: userRole.companyId,
        projectId: userRole.projectId,
        roleCode: userRole.roleCode,
        validUntil: userRole.validUntil,
        createdBy: userRole.createdBy,
        fullName: user.fullName,
        timeZone: company.timeZone,
      })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .innerJoin(company, eq(company.id, userRole.companyId))
      .where(
        and(
          eq(userRole.scopeLevel, 'project'),
          gt(userRole.validUntil, new Date(from)),
          lte(userRole.validUntil, new Date(to)),
          ne(userRole.validUntil, userRole.updatedAt),
          isNotNull(userRole.projectId),
        ),
      )
      .all();
    return rows.flatMap((row) =>
      row.companyId && row.projectId && row.validUntil
        ? [
            {
              ...row,
              companyId: row.companyId,
              projectId: row.projectId,
              validUntil: row.validUntil,
            },
          ]
        : [],
    );
  }

  /** Whether users are active (filters a recipient list). */
  async activeOnly(userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({ id: user.id })
      .from(user)
      .where(and(inArray(user.id, [...userIds]), eq(user.status, 'active')))
      .all();
    return rows.map((row) => row.id);
  }
}
