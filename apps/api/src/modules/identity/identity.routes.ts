import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  type LoginResponseDto,
  loginRequestSchema,
  updateMeRequestSchema,
} from '@hse/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import { accepted, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { rateLimitByIp } from '../../core/middleware/rate-limit.middleware';
import { requireSameOrigin } from '../../core/middleware/same-origin.middleware';
import { SessionExpiredError } from './identity.errors';
import type { AppEnv } from '../../core/context/app-context';
import { currentAccount, identityServicesFor, validateIdentitySession } from './identity.factory';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';

const signedIn = authenticate(validateIdentitySession);
const sessionIdParam = z.object({ sessionId: z.uuid() });
const tokenQuery = z.object({ token: z.string().min(1).max(200) });

/**
 * `/api/v1/auth` — controller only: parse, call a service, respond.
 * Business rules live in AuthService, SessionService and AccountService.
 */
export const authRoutes = new Hono<AppEnv>()
  // US-001
  .post(
    '/login',
    rateLimitByIp('AUTH_RATE_LIMITER', 'login'),
    validate('json', loginRequestSchema),
    async (c) => {
      const { email, password } = c.req.valid('json');
      const result = await identityServicesFor(c).auth.login(email, password);
      setRefreshCookie(c, result.refreshToken, result.sessionAbsoluteExpiresAt);
      const body: LoginResponseDto = {
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        user: result.user,
      };
      return ok(c, body, { message: 'Signed in' });
    },
  )

  .post(
    '/refresh',
    requireSameOrigin(),
    rateLimitByIp('AUTH_RATE_LIMITER', 'refresh'),
    async (c) => {
      const token = readRefreshCookie(c);
      if (!token) throw new SessionExpiredError();
      try {
        const result = await identityServicesFor(c).auth.refresh(token);
        if (result.refreshToken)
          setRefreshCookie(c, result.refreshToken, result.sessionAbsoluteExpiresAt);
        return ok(c, {
          accessToken: result.accessToken,
          accessTokenExpiresAt: result.accessTokenExpiresAt,
        });
      } catch (error) {
        if (error instanceof SessionExpiredError) clearRefreshCookie(c);
        throw error;
      }
    },
  )

  // US-004 — works even when the session has already expired (idempotent).
  .post('/logout', requireSameOrigin(), async (c) => {
    await identityServicesFor(c).auth.logout(readRefreshCookie(c));
    clearRefreshCookie(c);
    return ok(c, null, { message: 'Signed out' });
  })

  .get('/me', signedIn, async (c) =>
    ok(c, await identityServicesFor(c).account.me(currentAccount(c))),
  )

  // US-007 (and PLT-03 language switching)
  .patch('/me', signedIn, validate('json', updateMeRequestSchema), async (c) => {
    const user = await identityServicesFor(c).account.updateProfile(
      currentAccount(c),
      c.req.valid('json'),
    );
    return ok(c, user, { message: 'Profile updated' });
  })

  // US-002 — always the same answer (T-21).
  .post(
    '/forgot-password',
    rateLimitByIp('AUTH_RATE_LIMITER', 'forgot'),
    validate('json', forgotPasswordRequestSchema),
    async (c) => {
      await identityServicesFor(c).passwordReset.requestReset(c.req.valid('json').email);
      return accepted(c, null);
    },
  )

  // US-003
  .get(
    '/reset-password',
    rateLimitByIp('AUTH_RATE_LIMITER', 'reset'),
    validate('query', tokenQuery),
    async (c) =>
      ok(c, await identityServicesFor(c).passwordReset.preview(c.req.valid('query').token)),
  )
  .post(
    '/reset-password',
    rateLimitByIp('AUTH_RATE_LIMITER', 'reset'),
    validate('json', resetPasswordRequestSchema),
    async (c) => {
      const { token, password } = c.req.valid('json');
      const revokedSessions = await identityServicesFor(c).passwordReset.reset(token, password);
      return ok(c, { revokedSessions }, { message: 'Password changed' });
    },
  )

  // US-005
  .post('/change-password', signedIn, validate('json', changePasswordRequestSchema), async (c) => {
    const { currentPassword, newPassword } = c.req.valid('json');
    const revokedSessions = await identityServicesFor(c).account.changePassword(
      c.get('principal'),
      currentAccount(c),
      currentPassword,
      newPassword,
    );
    return ok(c, null, { message: 'Password changed', meta: { revokedSessions } });
  })

  // US-010
  .get('/sessions', signedIn, async (c) =>
    ok(c, await identityServicesFor(c).sessions.list(c.get('principal'))),
  )

  .delete('/sessions/:sessionId', signedIn, validate('param', sessionIdParam), async (c) => {
    const { sessionId } = c.req.valid('param');
    await identityServicesFor(c).sessions.revoke(c.get('principal'), currentAccount(c), sessionId);
    return ok(c, null, { message: 'Session ended' });
  })

  .post('/sessions/revoke-others', signedIn, async (c) => {
    const revokedSessions = await identityServicesFor(c).sessions.revokeOthers(
      c.get('principal'),
      currentAccount(c),
    );
    return ok(c, null, { message: 'Other sessions ended', meta: { revokedSessions } });
  });
