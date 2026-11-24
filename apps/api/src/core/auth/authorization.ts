import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../context/app-context';
import { ForbiddenError, UnauthenticatedError } from '../errors/app-error';
import type { Principal } from './principal';

/**
 * Authorization foundation: Identity → Role → Permission → Scope (Doc 07 §2).
 *
 * Permissions are single actions named `<module>.<action>` (Doc 07 §5), e.g.
 * `inspection.approve`. The catalogue is data, seeded per module — never hard-coded
 * in route handlers.
 */
export type Permission = `${string}.${string}`;

/** The scope a permission is evaluated in (Doc 07 §6). Area/Location scopes are future. */
export type PermissionScope =
  | { level: 'platform' }
  | { level: 'company'; companyId: string }
  | { level: 'project'; companyId: string; projectId: string };

/**
 * Resolves whether a principal holds a permission in a scope.
 * Implemented by the identity module in Sprint 3 (US-008 / US-009).
 */
export interface PermissionChecker {
  hasPermission(
    principal: Principal,
    permission: Permission,
    scope: PermissionScope,
  ): Promise<boolean>;
}

/** Default checker: denies everything (Master Rules: "Deny by default"). */
export const denyAllPermissionChecker: PermissionChecker = {
  hasPermission: () => Promise.resolve(false),
};

export type ScopeResolver = (c: Context<AppEnv>) => PermissionScope | Promise<PermissionScope>;

/**
 * Route guard. Must run after `authenticate()`.
 *
 * @example
 * router.post('/', requirePermission(checker, 'inspection.create', projectScopeFromParams), handler)
 */
export const requirePermission = (
  checker: PermissionChecker,
  permission: Permission,
  resolveScope: ScopeResolver,
) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.get('principal') as Principal | undefined;
    if (!principal) throw new UnauthenticatedError();

    const scope = await resolveScope(c);
    const allowed = await checker.hasPermission(principal, permission, scope);
    if (!allowed) {
      c.get('logger').info('permission denied', { permission, scope: scope.level });
      throw new ForbiddenError();
    }
    await next();
  });
