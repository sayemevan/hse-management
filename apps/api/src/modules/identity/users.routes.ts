import {
  acceptInvitationRequestSchema,
  buildPaginationMeta,
  inviteUserRequestSchema,
  type LoginResponseDto,
  userListQuerySchema,
} from '@hse/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import { accepted, created, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { rateLimitByIp } from '../../core/middleware/rate-limit.middleware';
import { requireCompanyPermission } from './company-permission';
import { identityServicesFor, validateIdentitySession } from './identity.factory';
import { setRefreshCookie } from './refresh-cookie';

const signedIn = authenticate(validateIdentitySession);
const idParam = z.object({ id: z.uuid() });

/** `/api/v1/users` — the Company Administrator's user list and invitations (US-006). */
export const userRoutes = new Hono<AppEnv>()
  .get(
    '/',
    signedIn,
    requireCompanyPermission('users.view'),
    validate('query', userListQuerySchema),
    async (c) => {
      const { search, page, pageSize } = c.req.valid('query');
      const result = await identityServicesFor(c).invitations.list(search, { page, pageSize });
      return ok(c, result.items, {
        meta: { ...buildPaginationMeta({ page, pageSize }, result.total) },
      });
    },
  )
  .post(
    '/invitations',
    signedIn,
    requireCompanyPermission('users.invite'),
    validate('json', inviteUserRequestSchema),
    async (c) => {
      const user = await identityServicesFor(c).invitations.invite(
        c.get('principal'),
        c.req.valid('json'),
      );
      return created(c, user, { message: 'Invitation sent' });
    },
  )
  .post(
    '/:id/invitation/resend',
    signedIn,
    requireCompanyPermission('users.invite'),
    validate('param', idParam),
    async (c) => {
      await identityServicesFor(c).invitations.resend(c.get('principal'), c.req.valid('param').id);
      return accepted(c, null, { message: 'Invitation sent again' });
    },
  )
  .delete(
    '/:id/invitation',
    signedIn,
    requireCompanyPermission('users.invite'),
    validate('param', idParam),
    async (c) => {
      await identityServicesFor(c).invitations.cancel(c.get('principal'), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

/** `/api/v1/invitations` — the invited person's side (US-006). Public; the token is the credential. */
export const invitationRoutes = new Hono<AppEnv>()
  .get(
    '/',
    rateLimitByIp('AUTH_RATE_LIMITER', 'invitation'),
    validate('query', z.object({ token: z.string().min(1).max(200) })),
    async (c) =>
      ok(c, await identityServicesFor(c).invitations.preview(c.req.valid('query').token)),
  )
  .post(
    '/accept',
    rateLimitByIp('AUTH_RATE_LIMITER', 'invitation'),
    validate('json', acceptInvitationRequestSchema),
    async (c) => {
      const { token, password } = c.req.valid('json');
      const result = await identityServicesFor(c).invitations.accept(token, password);
      setRefreshCookie(c, result.refreshToken, result.sessionAbsoluteExpiresAt);
      const body: LoginResponseDto = {
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        user: result.user,
      };
      return ok(c, body, { message: 'Account activated' });
    },
  );
