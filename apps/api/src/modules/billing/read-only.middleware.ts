import type { TenantSubscriptionDto } from '@hse/shared';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../../core/context/app-context';
import { createDatabase } from '../../database/client';
import { API_V1_BASE_PATH } from '../../routes/paths';
import {
  type SubscriptionAccess,
  SubscriptionReadOnlyError,
  SubscriptionService,
} from '../subscription';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface AllowedWrite {
  /** Path under `/api/v1`: an exact path, or a prefix ending in `/`. */
  path: string;
  reason: string;
}

/**
 * Company writes that keep working in read-only mode (PLT-11 FR-2, O-36, T-24). Every other
 * company write is refused. This list is reviewed: a test lists every company write route
 * and fails when a new one is neither blocked on purpose nor listed here.
 */
export const READ_ONLY_ALLOWED_WRITES: readonly AllowedWrite[] = [
  { path: '/auth/', reason: 'sign-in, refresh, sign-out, reset, own profile, password, sessions' },
  { path: '/invitations/accept', reason: 'an invited user can still join and look' },
  { path: '/subscription/', reason: 'paying is how read-only mode ends' },
  { path: '/notifications/', reason: 'own notifications: mark read (PLT-17 FR-12)' },
  { path: '/me/last-project', reason: 'navigation memory, own account (PLT-19 FR-3)' },
];

export function isAllowedInReadOnly(apiPath: string): boolean {
  return READ_ONLY_ALLOWED_WRITES.some(({ path }) =>
    path.endsWith('/') ? apiPath.startsWith(path) : apiPath === path,
  );
}

function apiPathOf(fullPath: string): string {
  return fullPath.startsWith(API_V1_BASE_PATH)
    ? fullPath.slice(API_V1_BASE_PATH.length) || '/'
    : fullPath;
}

export function toTenantSubscription(access: SubscriptionAccess): TenantSubscriptionDto {
  return {
    state: access.state,
    endsAt: access.deadline,
    readOnlySince: access.readOnlySince,
    paymentUnderReview: access.pendingPayment !== null,
  };
}

/**
 * PLT-11 FR-1 – FR-5. On company requests: loads the subscription state for `GET /tenant`,
 * and refuses writes in read-only mode unless the route is on the allow-list. The state
 * comes from the server's dates and clock only (T-22). Runs after `resolveTenant()`.
 */
export const enforceSubscriptionAccess = (clock: () => number = Date.now) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const tenant = c.get('tenant') as AppEnv['Variables']['tenant'] | undefined;
    if (tenant?.kind !== 'company') return next();

    const apiPath = apiPathOf(c.req.path);
    const isWrite = WRITE_METHODS.has(c.req.method);
    const wantsProfile = apiPath === '/tenant' && c.req.method === 'GET';
    if (!wantsProfile && (!isWrite || isAllowedInReadOnly(apiPath))) return next();

    const access = await new SubscriptionService(createDatabase(c.env.DB), clock).access(
      tenant.company.id,
      c.get('config').billing,
    );
    if (wantsProfile) {
      c.set('tenantSubscription', access ? toTenantSubscription(access) : undefined);
      return next();
    }
    if (access?.state === 'read_only') {
      c.get('logger').info('write refused in read-only mode', { path: apiPath });
      throw new SubscriptionReadOnlyError(access.readOnlySince);
    }
    return next();
  });
