import {
  approveRegistrationRequestSchema,
  paginationQuerySchema,
  REGISTRATION_STATUSES,
  registrationRequestSchema,
  rejectRegistrationRequestSchema,
  resendVerificationRequestSchema,
  resubmissionRequestSchema,
  verifyEmailRequestSchema,
} from '@hse/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import { accepted, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { rateLimitByIp } from '../../core/middleware/rate-limit.middleware';
import { requirePlatformPermission, validateIdentitySession } from '../identity';
import { registrationServicesFor } from './registration.factory';

const limited = (bucket: string) => rateLimitByIp('AUTH_RATE_LIMITER', bucket);

/** `/api/v1/registrations` — public applicant endpoints (US-011.1, 011.2, 011.5). Base domain only. */
export const registrationRoutes = new Hono<AppEnv>()
  .get(
    '/slug-availability',
    limited('slug'),
    validate('query', z.object({ slug: z.string().trim().toLowerCase().max(63) })),
    async (c) => {
      const { slug } = c.req.valid('query');
      return ok(c, await registrationServicesFor(c).applicant.slugAvailability(slug));
    },
  )
  .post('/', limited('register'), validate('json', registrationRequestSchema), async (c) => {
    const input = c.req.valid('json');
    await registrationServicesFor(c).applicant.register(input);
    // FR-7: always the same answer, whether or not the email was already in use.
    return accepted(c, { email: input.applicantEmail });
  })
  .post(
    '/verify-email',
    limited('verify'),
    validate('json', verifyEmailRequestSchema),
    async (c) => {
      await registrationServicesFor(c).applicant.verifyEmail(c.req.valid('json').token);
      return ok(c, { status: 'submitted' });
    },
  )
  .post(
    '/resend-verification',
    limited('resend'),
    validate('json', resendVerificationRequestSchema),
    async (c) => {
      await registrationServicesFor(c).applicant.resendVerification(c.req.valid('json').email);
      return accepted(c, null);
    },
  )
  .get(
    '/resubmission',
    limited('resubmit'),
    validate('query', z.object({ token: z.string().min(1).max(200) })),
    async (c) => {
      const { token } = c.req.valid('query');
      return ok(c, await registrationServicesFor(c).applicant.resubmissionForm(token));
    },
  )
  .put(
    '/resubmission',
    limited('resubmit'),
    validate('json', resubmissionRequestSchema),
    async (c) => {
      await registrationServicesFor(c).applicant.resubmit(c.req.valid('json'));
      return ok(c, { status: 'submitted' });
    },
  );

const listQuery = paginationQuerySchema.extend({
  status: z.enum(REGISTRATION_STATUSES).optional(),
});
const idParam = z.object({ id: z.uuid() });
const signedIn = authenticate(validateIdentitySession);

/** `/api/v1/platform/registrations` — the System Owner's review queue (US-011.3, 011.4). */
export const platformRegistrationRoutes = new Hono<AppEnv>()
  .get(
    '/',
    signedIn,
    requirePlatformPermission('platform.registrations.view'),
    validate('query', listQuery),
    async (c) => {
      const { status, page, pageSize } = c.req.valid('query');
      const result = await registrationServicesFor(c).review.list(status, { page, pageSize });
      return ok(c, result.items, { meta: { ...result.meta } });
    },
  )
  .get(
    '/:id',
    signedIn,
    requirePlatformPermission('platform.registrations.view'),
    validate('param', idParam),
    async (c) => ok(c, await registrationServicesFor(c).review.detail(c.req.valid('param').id)),
  )
  .post(
    '/:id/approve',
    signedIn,
    requirePlatformPermission('platform.registrations.approve'),
    validate('param', idParam),
    validate('json', approveRegistrationRequestSchema),
    async (c) => {
      const result = await registrationServicesFor(c).review.approve(
        c.req.valid('param').id,
        c.req.valid('json'),
        c.get('principal'),
      );
      return ok(c, result, { message: 'Company created' });
    },
  )
  .post(
    '/:id/reject',
    signedIn,
    requirePlatformPermission('platform.registrations.reject'),
    validate('param', idParam),
    validate('json', rejectRegistrationRequestSchema),
    async (c) => {
      await registrationServicesFor(c).review.reject(
        c.req.valid('param').id,
        c.req.valid('json').reason,
        c.get('principal'),
      );
      return ok(c, { status: 'rejected' }, { message: 'Application rejected' });
    },
  );
