import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../context/app-context';

/** Logs one line per request with method, path, status and duration. Never logs bodies. */
export const requestLogger = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const startedAt = Date.now();
    await next();
    c.get('logger').info('request completed', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  });
