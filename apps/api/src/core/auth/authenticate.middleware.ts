import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../context/app-context';
import { UnauthenticatedError } from '../errors/app-error';
import type { Principal } from './principal';
import { TokenService } from './token-service';

const BEARER_PREFIX = 'Bearer ';

/**
 * Server-side check that the token's session is still valid (T-2): not revoked, not
 * expired, user still active, and the user belongs to the request's tenant.
 * Implemented by the identity module; core stays independent of business modules.
 */
export type SessionValidator = (c: Context<AppEnv>, principal: Principal) => Promise<void>;

export function tokenServiceFor(c: Context<AppEnv>): TokenService {
  const { auth } = c.get('config');
  return new TokenService({
    secret: auth.jwtSecret,
    issuer: auth.issuer,
    audience: auth.audience,
    accessTokenTtlSeconds: auth.accessTokenTtlSeconds,
  });
}

export function bearerToken(c: Context<AppEnv>): string | null {
  const header = c.req.header('authorization');
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Requires a valid access token **and** a valid server-side session, then sets `principal`.
 * Mount on every protected router (Doc 02 §3: "Every request must be authenticated").
 */
export const authenticate = (validateSession: SessionValidator) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const token = bearerToken(c);
    if (!token) throw new UnauthenticatedError();

    const principal = await tokenServiceFor(c).verifyAccessToken(token);
    await validateSession(c, principal);

    c.set('principal', principal);
    c.set('logger', c.get('logger').child({ userId: principal.userId }));
    await next();
  });
