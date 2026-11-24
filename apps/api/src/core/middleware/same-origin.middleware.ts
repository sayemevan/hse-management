import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../context/app-context';
import { ForbiddenError } from '../errors/app-error';
import { requestHost } from '../http/request-host';

/**
 * Cross-site request forgery guard for endpoints that act on a cookie (T-4).
 * The `Origin` header must be present and name the same host the request was sent to.
 * Combined with `SameSite=Strict` cookies this is defence in depth.
 */
export const requireSameOrigin = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const origin = c.req.header('origin');
    const host = requestHost(c)?.toLowerCase();

    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host.toLowerCase() : null;
    } catch {
      originHost = null;
    }

    if (!originHost || !host || originHost !== host) {
      c.get('logger').warn('cross-origin request rejected', { origin: origin ?? null });
      throw new ForbiddenError();
    }
    await next();
  });
