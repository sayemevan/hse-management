import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../../core/context/app-context';
import { NotFoundError } from '../../core/errors/app-error';

/**
 * Restricts a route to the base domain (platform context). On a company subdomain the route
 * simply does not exist (404), e.g. registration and the platform console (US-011.1).
 * Must run after `resolveTenant()`.
 */
export const requirePlatformContext = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.get('tenant').kind !== 'platform') throw new NotFoundError();
    await next();
  });
