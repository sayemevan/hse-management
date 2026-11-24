import type { CompanyPermissionCode } from '@hse/shared';
import { createMiddleware } from 'hono/factory';

import { requirePermission } from '../../core/auth/authorization';
import type { AppEnv } from '../../core/context/app-context';
import { NotFoundError } from '../../core/errors/app-error';
import type { Database } from '../../database/client';
import {
  matrixPermissionChecker,
  PermissionResolver,
  permissionResolverFor,
} from './permission-matrix';

export type CompanyPermission = CompanyPermissionCode;

/** The company permissions a user holds right now (PLT-16), sorted for stable output. */
export async function loadCompanyPermissions(
  db: Database,
  userId: string,
  companyId: string,
  clock: () => number = Date.now,
): Promise<string[]> {
  const granted = await new PermissionResolver(db, clock).companyPermissions(userId, companyId);
  return [...granted].sort();
}

/**
 * Route guard for company endpoints. Must run after `resolveTenant()` and `authenticate()`.
 * The scope is always the request's tenant, never a company id sent by the client.
 */
export const requireCompanyPermission = (permission: CompanyPermission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const tenant = c.get('tenant');
    if (tenant.kind !== 'company') throw new NotFoundError();
    const checker = matrixPermissionChecker(permissionResolverFor(c));
    return requirePermission(checker, permission, () => ({
      level: 'company',
      companyId: tenant.company.id,
    }))(c, next);
  });
