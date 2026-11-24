import {
  effectiveRolePermissions,
  isCompanyWideRole,
  permissionDefinition,
  type PermissionScopeLevel,
} from '@hse/shared';
import type { Context } from 'hono';

import type { PermissionChecker } from '../../core/auth/authorization';
import type { AppEnv } from '../../core/context/app-context';
import { createDatabase, type Database } from '../../database/client';
import type { RoleCode, UserRoleRow, UserRow } from './identity.schema';
import { PermissionRepository } from './permission.repository';
import { RoleRepository } from './role.repository';
import { UserRepository } from './user.repository';

function inScope(permissions: Iterable<string>, scope: PermissionScopeLevel): Set<string> {
  const result = new Set<string>();
  for (const code of permissions) {
    if (permissionDefinition(code)?.scope === scope) result.add(code);
  }
  return result;
}

/** Where a user may use a project-scope permission (PLT-16 FR-10, US-016 FR-4). */
export interface ProjectAccess {
  /** A company-wide role holds it: every project of the company (O-45). */
  allProjects: boolean;
  /** Otherwise, the projects whose project role holds it. */
  projectIds: string[];
}

/**
 * Works out permissions from the matrix (PLT-16 FR-3 – FR-7, T-33). Reads the database once
 * per question and remembers the answers for the rest of the request only (T-32), so a
 * change applies on the next request.
 */
export class PermissionResolver {
  private readonly users: UserRepository;
  private readonly roles: RoleRepository;
  private readonly permissions: PermissionRepository;
  private readonly accounts = new Map<string, Promise<UserRow | undefined>>();
  private readonly roleRows = new Map<string, Promise<UserRoleRow[]>>();
  private readonly rolePermissions = new Map<string, Promise<Set<string>>>();

  constructor(
    db: Database,
    private readonly clock: () => number = Date.now,
  ) {
    this.users = new UserRepository(db);
    this.roles = new RoleRepository(db);
    this.permissions = new PermissionRepository(db);
  }

  private account(userId: string): Promise<UserRow | undefined> {
    let found = this.accounts.get(userId);
    if (!found) {
      found = this.users.findById(userId);
      this.accounts.set(userId, found);
    }
    return found;
  }

  /** Role assignments in force now (valid_from ≤ now < valid_until). */
  activeRoles(userId: string): Promise<UserRoleRow[]> {
    let found = this.roleRows.get(userId);
    if (!found) {
      found = this.roles.listActiveForUser(userId, this.clock());
      this.roleRows.set(userId, found);
    }
    return found;
  }

  /** A role's permissions: defaults, then the company's differences, then locks. */
  roleGrants(companyId: string | null, roleCode: RoleCode): Promise<Set<string>> {
    const key = `${companyId ?? '-'}:${roleCode}`;
    let found = this.rolePermissions.get(key);
    if (!found) {
      found = (async () => {
        const [defaults, overrides] = await Promise.all([
          this.permissions.defaultsFor([roleCode]),
          companyId ? this.permissions.overridesFor(companyId, [roleCode]) : Promise.resolve([]),
        ]);
        return effectiveRolePermissions(
          roleCode,
          defaults.map((row) => row.permissionCode),
          overrides,
        );
      })();
      this.rolePermissions.set(key, found);
    }
    return found;
  }

  private async member(userId: string, companyId: string): Promise<boolean> {
    const account = await this.account(userId);
    return account?.status === 'active' && account.companyId === companyId;
  }

  async platformPermissions(userId: string): Promise<Set<string>> {
    const account = await this.account(userId);
    if (account?.status !== 'active' || account.companyId !== null) return new Set();
    const result = new Set<string>();
    for (const row of await this.activeRoles(userId)) {
      if (row.scopeLevel !== 'platform') continue;
      for (const code of inScope(await this.roleGrants(null, row.roleCode), 'platform')) {
        result.add(code);
      }
    }
    return result;
  }

  /** FR-5: company-scope permissions from the user's company role. */
  async companyPermissions(userId: string, companyId: string): Promise<Set<string>> {
    if (!(await this.member(userId, companyId))) return new Set();
    const result = new Set<string>();
    for (const row of await this.activeRoles(userId)) {
      if (row.scopeLevel !== 'company' || row.companyId !== companyId) continue;
      for (const code of inScope(await this.roleGrants(companyId, row.roleCode), 'company')) {
        result.add(code);
      }
    }
    return result;
  }

  /**
   * FR-6: project-scope permissions on one project. The caller has already checked that the
   * project belongs to `companyId` (the project module does, T-35).
   */
  async projectPermissions(
    userId: string,
    companyId: string,
    projectId: string,
  ): Promise<Set<string>> {
    if (!(await this.member(userId, companyId))) return new Set();
    const result = new Set<string>();
    for (const row of await this.activeRoles(userId)) {
      if (row.companyId !== companyId) continue;
      const applies =
        (row.scopeLevel === 'company' && isCompanyWideRole(row.roleCode)) ||
        (row.scopeLevel === 'project' && row.projectId === projectId);
      if (!applies) continue;
      for (const code of inScope(await this.roleGrants(companyId, row.roleCode), 'project')) {
        result.add(code);
      }
    }
    return result;
  }

  /** FR-10: where the user holds a project-scope permission. */
  async projectAccess(
    userId: string,
    companyId: string,
    permission: string,
  ): Promise<ProjectAccess> {
    if (!(await this.member(userId, companyId))) return { allProjects: false, projectIds: [] };
    const projectIds = new Set<string>();
    for (const row of await this.activeRoles(userId)) {
      if (row.companyId !== companyId) continue;
      const grants = await this.roleGrants(companyId, row.roleCode);
      if (!grants.has(permission)) continue;
      if (row.scopeLevel === 'company' && isCompanyWideRole(row.roleCode)) {
        return { allProjects: true, projectIds: [] };
      }
      if (row.scopeLevel === 'project' && row.projectId) projectIds.add(row.projectId);
    }
    return { allProjects: false, projectIds: [...projectIds] };
  }
}

/** One checker for every scope (T-31). Replaces the temporary checkers of T-14 and T-20. */
export function matrixPermissionChecker(resolver: PermissionResolver): PermissionChecker {
  return {
    async hasPermission(principal, code, scope) {
      // FR-7: unknown permissions, or a permission used at the wrong scope, are denied.
      if (permissionDefinition(code)?.scope !== scope.level) return false;
      switch (scope.level) {
        case 'platform':
          return (await resolver.platformPermissions(principal.userId)).has(code);
        case 'company':
          return (await resolver.companyPermissions(principal.userId, scope.companyId)).has(code);
        case 'project':
          return (
            await resolver.projectPermissions(principal.userId, scope.companyId, scope.projectId)
          ).has(code);
      }
    },
  };
}

const resolvers = new WeakMap<Request, PermissionResolver>();

/** The resolver for this request (T-32): shared by every guard and service of the request. */
export function permissionResolverFor(c: Context<AppEnv>): PermissionResolver {
  let resolver = resolvers.get(c.req.raw);
  if (!resolver) {
    resolver = new PermissionResolver(createDatabase(c.env.DB));
    resolvers.set(c.req.raw, resolver);
  }
  return resolver;
}
