import { createMiddleware } from 'hono/factory';

import type { AppEnv, Bindings } from '../context/app-context';
import { RateLimitedError } from '../errors/app-error';
import { requestMeta } from '../http/request-meta';

type RateLimiterBinding = {
  [K in keyof Bindings]-?: NonNullable<Bindings[K]> extends RateLimit ? K : never;
}[keyof Bindings];

/**
 * Per-IP rate limiting with a Workers rate-limit binding (T-7). Limits and periods are
 * configured on the binding in wrangler.jsonc; `bucket` keeps endpoints apart.
 */
export const rateLimitByIp = (binding: RateLimiterBinding, bucket: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const ip = requestMeta(c).ipAddress ?? 'unknown';
    const { success } = await c.env[binding].limit({ key: `${bucket}:${ip}` });
    if (!success) {
      c.get('logger').warn('rate limit exceeded', { bucket });
      throw new RateLimitedError();
    }
    await next();
  });
