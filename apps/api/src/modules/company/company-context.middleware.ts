import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../../core/context/app-context';
import { NotFoundError } from '../../core/errors/app-error';

/**
 * Restricts a route to a company subdomain. On the base domain the route does not exist
 * (404), e.g. company settings and user management (Sprint 3). Must run after `resolveTenant()`.
 */
export const requireCompanyContext = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.get('tenant').kind !== 'company') throw new NotFoundError();
    await next();
  });
