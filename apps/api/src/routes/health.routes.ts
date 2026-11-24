import { Hono } from 'hono';

import type { AppEnv } from '../core/context/app-context';
import { ok } from '../core/http/response';

/**
 * Liveness probe (infrastructure, not a business API). Unauthenticated by design and
 * returns no sensitive data.
 */
export const healthRoutes = new Hono<AppEnv>().get('/', (c) =>
  ok(c, {
    status: 'ok',
    environment: c.get('config').environment,
    timestamp: new Date().toISOString(),
  }),
);
