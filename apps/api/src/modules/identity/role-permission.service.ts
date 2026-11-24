import {
  COMPANY_ROLES,
  type CompanyRole,
  defaultPermissionsOf,
  effectiveRolePermissions,
  isCompanyWideRole,
  isLocked,
  PERMISSIONS,
  permissionDefinition,
  type RoleDetailDto,
  type RoleSummaryDto,
} from '@hse/shared';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/app-error';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import { UnitOfWork } from '../../database/unit-of-work';
import { AuditLogService } from '../../platform/audit-log';
import { NotificationService } from '../../platform/notification';
import { ProjectAudience } from './project-audience';
import { PermissionLockedError } from './identity.errors';
import type { CompanyRolePermissionRow } from './identity.schema';
import { PermissionRepository } from './permission.repository';
import { RoleRepository } from './role.repository';

export interface RolePermissionDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
}

/** Company and project permissions: the ones a company may change (never platform ones). */
const EDITABLE = PERMISSIONS.filter((entry) => entry.scope !== 'platform');

function isCompanyRole(code: string): code is CompanyRole {
  return (COMPANY_ROLES as readonly string[]).includes(code);
}

function versionOf(rows: readonly CompanyRolePermissionRow[]): number {
  return rows.reduce((latest, row) => Math.max(latest, row.updatedAt.getTime()), 0);
}

/** US-009: what each company role may do in one company. */
export class RolePermissionService {
  private readonly permissions: PermissionRepository;
  private readonly roles: RoleRepository;
  private readonly audit: AuditLogService;

  constructor(private readonly deps: RolePermissionDeps) {
    this.permissions = new PermissionRepository(deps.db);
    this.roles = new RoleRepository(deps.db);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
  }

  /** FR-1. */
  async list(company: TenantCompany): Promise<RoleSummaryDto[]> {
    const [overrides, counts] = await Promise.all([
      this.permissions.allOverrides(company.id),
      this.roles.userCountsByRole(company.id, this.deps.clock()),
    ]);
    return COMPANY_ROLES.map((code) => ({
      code,
      userCount: counts.get(code) ?? 0,
      customised: overrides.some((row) => row.roleCode === code),
      companyWide: isCompanyWideRole(code),
    }));
  }

  /** FR-2. */
  async detail(company: TenantCompany, roleCode: string): Promise<RoleDetailDto> {
    if (!isCompanyRole(roleCode)) throw new NotFoundError();
    const [overrides, counts] = await Promise.all([
      this.permissions.overridesFor(company.id, [roleCode]),
      this.roles.userCountsByRole(company.id, this.deps.clock()),
    ]);
    const defaults = new Set(defaultPermissionsOf(roleCode));
    const effective = effectiveRolePermissions(roleCode, defaults, overrides);
    return {
      code: roleCode,
      companyWide: isCompanyWideRole(roleCode),
      userCount: counts.get(roleCode) ?? 0,
      customised: overrides.length > 0,
      version: versionOf(overrides),
      permissions: EDITABLE.map((entry) => ({
        code: entry.code,
        module: entry.module,
        scope: entry.scope,
        granted: effective.has(entry.code),
        default: defaults.has(entry.code),
        locked: isLocked(entry.code, roleCode),
      })),
    };
  }

  /** FR-3 – FR-8. */
  async update(
    company: TenantCompany,
    principal: Principal,
    roleCode: string,
    version: number,
    granted: readonly string[],
  ): Promise<RoleDetailDto> {
    if (!isCompanyRole(roleCode)) throw new NotFoundError();
    const unknown = granted.filter((code) => {
      const definition = permissionDefinition(code);
      return !definition || definition.scope === 'platform';
    });
    if (unknown.length > 0) {
      throw new ValidationError(
        unknown.map((code) => ({ path: 'granted', message: `unknownPermission:${code}` })),
      );
    }
    const wanted = new Set(granted);
    for (const entry of EDITABLE) {
      if (isLocked(entry.code, roleCode) && !wanted.has(entry.code)) {
        throw new PermissionLockedError(entry.code);
      }
    }
    const current = await this.permissions.overridesFor(company.id, [roleCode]);
    if (versionOf(current) !== version) {
      throw new ConflictError('Someone else changed this role. Reload to see their changes.');
    }

    const defaults = new Set(defaultPermissionsOf(roleCode));
    const before = effectiveRolePermissions(roleCode, defaults, current);
    const differences = EDITABLE.filter((entry) => !isLocked(entry.code, roleCode))
      .filter((entry) => wanted.has(entry.code) !== defaults.has(entry.code))
      .map((entry) => ({ permissionCode: entry.code, granted: wanted.has(entry.code) }));
    const after = effectiveRolePermissions(roleCode, defaults, differences);
    await this.save(
      company,
      principal,
      roleCode,
      differences,
      before,
      after,
      'role.permissions.changed',
    );
    return this.detail(company, roleCode);
  }

  /** FR-7. */
  async reset(
    company: TenantCompany,
    principal: Principal,
    roleCode: string,
    version: number,
  ): Promise<RoleDetailDto> {
    if (!isCompanyRole(roleCode)) throw new NotFoundError();
    const current = await this.permissions.overridesFor(company.id, [roleCode]);
    if (versionOf(current) !== version) {
      throw new ConflictError('Someone else changed this role. Reload to see their changes.');
    }
    const defaults = new Set(defaultPermissionsOf(roleCode));
    const before = effectiveRolePermissions(roleCode, defaults, current);
    const after = effectiveRolePermissions(roleCode, defaults, []);
    await this.save(company, principal, roleCode, [], before, after, 'role.permissions.reset');
    return this.detail(company, roleCode);
  }

  private async save(
    company: TenantCompany,
    principal: Principal,
    roleCode: CompanyRole,
    differences: { permissionCode: string; granted: boolean }[],
    before: Set<string>,
    after: Set<string>,
    action: 'role.permissions.changed' | 'role.permissions.reset',
  ): Promise<void> {
    const added = [...after].filter((code) => !before.has(code)).sort();
    const removed = [...before].filter((code) => !after.has(code)).sort();
    if (added.length === 0 && removed.length === 0 && action === 'role.permissions.changed') return;
    const now = this.deps.clock();
    const affectedUsers = (await this.roles.userCountsByRole(company.id, now)).get(roleCode) ?? 0;
    await new UnitOfWork(this.deps.db)
      .add(
        ...this.permissions.replaceOverrides(
          company.id,
          roleCode,
          differences,
          principal.userId,
          now,
        ),
        this.audit.entry({
          action,
          actorUserId: principal.userId,
          companyId: company.id,
          entityType: 'role',
          entityId: roleCode,
          oldValue: { removed },
          newValue: { added, affectedUsers },
        }),
        ...new NotificationService(this.deps.db, this.deps.clock).entries({
          type: 'role.permissions.changed',
          companyId: company.id,
          entityType: 'role',
          entityId: roleCode,
          actorUserId: principal.userId,
          params: { roleCode, reset: action === 'role.permissions.reset' },
          recipients: await new ProjectAudience(this.deps.db, this.deps.clock).companyRoleHolders(
            company.id,
            ['company_administrator'],
          ),
        }),
      )
      .commit();
  }
}
