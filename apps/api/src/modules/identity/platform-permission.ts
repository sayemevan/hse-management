import type { PlatformPermissionCode } from '@hse/shared';
import { createMiddleware } from 'hono/factory';

import { requirePermission } from '../../core/auth/authorization';
import type { AppEnv } from '../../core/context/app-context';
import { matrixPermissionChecker, permissionResolverFor } from './permission-matrix';

/** Route guard for platform-console endpoints (PLT-16). Must run after `authenticate()`. */
export const requirePlatformPermission = (permission: PlatformPermissionCode) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const checker = matrixPermissionChecker(permissionResolverFor(c));
    return requirePermission(checker, permission, () => ({ level: 'platform' }))(c, next);
  });
