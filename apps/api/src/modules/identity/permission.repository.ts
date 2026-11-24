import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import {
  companyRolePermission,
  type CompanyRolePermissionRow,
  permission,
  type RoleCode,
  rolePermission,
} from './identity.schema';

/** The only code that reads or writes the permission tables (PLT-16, US-009). */
export class PermissionRepository {
  constructor(private readonly db: Database) {}

  catalogue() {
    return this.db.select().from(permission).orderBy(permission.sortOrder).all();
  }

  defaultMatrix() {
    return this.db.select().from(rolePermission).all();
  }

  async defaultsFor(
    roleCodes: readonly RoleCode[],
  ): Promise<{ roleCode: RoleCode; permissionCode: string }[]> {
    if (roleCodes.length === 0) return [];
    return this.db
      .select()
      .from(rolePermission)
      .where(inArray(rolePermission.roleCode, [...roleCodes]))
      .all();
  }

  async overridesFor(
    companyId: string,
    roleCodes: readonly RoleCode[],
  ): Promise<CompanyRolePermissionRow[]> {
    if (roleCodes.length === 0) return [];
    return this.db
      .select()
      .from(companyRolePermission)
      .where(
        and(
          eq(companyRolePermission.companyId, companyId),
          inArray(companyRolePermission.roleCode, [...roleCodes]),
        ),
      )
      .all();
  }

  /** Every difference the company has, for the role list (US-009 FR-1). */
  allOverrides(companyId: string): Promise<CompanyRolePermissionRow[]> {
    return this.db
      .select()
      .from(companyRolePermission)
      .where(eq(companyRolePermission.companyId, companyId))
      .all();
  }

  /** Replaces a role's differences in one batch (US-009 FR-3, FR-7). */
  replaceOverrides(
    companyId: string,
    roleCode: RoleCode,
    rows: { permissionCode: string; granted: boolean }[],
    actorId: string,
    now: number,
  ): Statement[] {
    const statements: Statement[] = [
      this.db
        .delete(companyRolePermission)
        .where(
          and(
            eq(companyRolePermission.companyId, companyId),
            eq(companyRolePermission.roleCode, roleCode),
          ),
        ),
    ];
    if (rows.length > 0) {
      statements.push(
        this.db.insert(companyRolePermission).values(
          rows.map((row) => ({
            companyId,
            roleCode,
            permissionCode: row.permissionCode,
            granted: row.granted,
            createdBy: actorId,
            updatedBy: actorId,
            createdAt: new Date(now),
            updatedAt: new Date(now),
          })),
        ),
      );
    }
    return statements;
  }
}
