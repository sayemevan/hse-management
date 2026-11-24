import type { Context } from 'hono';

import type { AppEnv } from '../context/app-context';

const FORWARDED_HOST_HEADER = 'x-forwarded-host';

/**
 * The host the user actually typed, including any port.
 * `x-forwarded-host` is trusted only when configured (local Next.js dev proxy); in
 * production the API runs on the same host as the web app via a Workers route (T-4).
 */
export function requestHost(c: Context<AppEnv>): string | undefined {
  const { trustForwardedHost } = c.get('config').tenancy;
  const forwarded = trustForwardedHost
    ? c.req.header(FORWARDED_HOST_HEADER)?.split(',')[0]?.trim()
    : undefined;
  return forwarded ?? c.req.header('host');
}
