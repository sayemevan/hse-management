import {
  PAYMENT_STATUSES,
  confirmPaymentRequestSchema,
  paginationQuerySchema,
  rejectPaymentRequestSchema,
  submitPaymentFieldsSchema,
  SUBSCRIPTION_STATES,
} from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import { requestLanguage } from '../../core/http/request-language';
import { requestMeta } from '../../core/http/request-meta';
import { created, ok } from '../../core/http/response';
import { toIssues, validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import type { OpenedFile } from '../../platform/file-storage';
import {
  currentAccount,
  requireCompanyPermission,
  requirePlatformPermission,
  validateIdentitySession,
} from '../identity';
import { BillingContext } from './billing.context';
import { PaymentReviewService } from './payment-review.service';
import { PaymentService } from './payment.service';

const signedIn = authenticate(validateIdentitySession);
const idParam = z.object({ id: z.uuid() });

function contextFor(c: Context<AppEnv>): BillingContext {
  return new BillingContext({
    db: createDatabase(c.env.DB),
    config: c.get('config'),
    meta: requestMeta(c),
    logger: c.get('logger'),
    queue: c.env.JOBS,
    cache: c.env.CACHE,
    bucket: c.env.FILES,
    clock: Date.now,
  });
}

function tenantCompany(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

/** The signed-in user's language, else the company's (D-21). */
function companyLanguage(c: Context<AppEnv>) {
  return currentAccount(c).preferredLanguage ?? tenantCompany(c).defaultLanguage;
}

/** Streams a receipt: never cached, never sniffed (PLT-07 FR-6, PLT-14 FR-3). */
function serveReceipt(c: Context<AppEnv>, opened: OpenedFile) {
  return c.body(opened.body, 200, {
    'Content-Type': opened.row.contentType,
    'Content-Disposition': `inline; filename="${opened.row.fileName}"`,
    'Content-Length': String(opened.row.sizeBytes),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
}

/** `/api/v1/subscription` — the company's subscription page and payments (PLT-13). */
export const subscriptionRoutes = new Hono<AppEnv>()
  .get('/', signedIn, requireCompanyPermission('subscription.view'), async (c) =>
    ok(c, await new PaymentService(contextFor(c)).summary(tenantCompany(c), companyLanguage(c))),
  )
  .get('/payments', signedIn, requireCompanyPermission('subscription.pay'), async (c) =>
    ok(c, await new PaymentService(contextFor(c)).list(tenantCompany(c), companyLanguage(c))),
  )
  .post('/payments', signedIn, requireCompanyPermission('subscription.pay'), async (c) => {
    const form = await c.req.formData().catch(() => null);
    const receipt = form?.get('file');
    const fields = submitPaymentFieldsSchema.safeParse({
      planCode: form?.get('planCode') ?? undefined,
      billingCycle: form?.get('billingCycle') ?? undefined,
      amount: form?.get('amount') ?? undefined,
      transferredOn: form?.get('transferredOn') ?? undefined,
      reference: form?.get('reference') ?? undefined,
    });
    const issues = fields.success ? [] : toIssues(fields.error.issues);
    if (!(receipt instanceof File)) issues.push({ path: 'file', message: 'required' });
    if (!fields.success || !(receipt instanceof File)) throw new ValidationError(issues);

    const payment = await new PaymentService(contextFor(c)).submit(
      tenantCompany(c),
      c.get('principal'),
      fields.data,
      receipt,
      companyLanguage(c),
    );
    return created(c, payment, { message: 'Payment submitted' });
  })
  .delete(
    '/payments/:id',
    signedIn,
    requireCompanyPermission('subscription.pay'),
    validate('param', idParam),
    async (c) => {
      await new PaymentService(contextFor(c)).withdraw(
        tenantCompany(c),
        c.get('principal'),
        c.req.valid('param').id,
      );
      return c.body(null, 204);
    },
  );

const paymentListQuery = paginationQuerySchema.extend({
  status: z.enum(PAYMENT_STATUSES).default('pending'),
});

/** `/api/v1/platform/payments` — the System Owner's payment queue (PLT-14). */
export const platformPaymentRoutes = new Hono<AppEnv>()
  .get(
    '/',
    signedIn,
    requirePlatformPermission('platform.payments.review'),
    validate('query', paymentListQuery),
    async (c) => {
      const { status, page, pageSize } = c.req.valid('query');
      const service = new PaymentReviewService(contextFor(c));
      const [result, pending] = await Promise.all([
        service.list(status, { page, pageSize }, requestLanguage(c)),
        service.countPending(),
      ]);
      return ok(c, result.items, { meta: { ...result.meta, pendingCount: pending } });
    },
  )
  .get(
    '/:id',
    signedIn,
    requirePlatformPermission('platform.payments.review'),
    validate('param', idParam),
    async (c) =>
      ok(
        c,
        await new PaymentReviewService(contextFor(c)).detail(
          c.req.valid('param').id,
          requestLanguage(c),
        ),
      ),
  )
  .get(
    '/:id/file',
    signedIn,
    requirePlatformPermission('platform.payments.review'),
    validate('param', idParam),
    async (c) => {
      const opened = await new PaymentReviewService(contextFor(c)).openFile(
        c.req.valid('param').id,
      );
      if (!opened) throw new NotFoundError();
      return serveReceipt(c, opened);
    },
  )
  .post(
    '/:id/confirm',
    signedIn,
    requirePlatformPermission('platform.payments.review'),
    validate('param', idParam),
    validate('json', confirmPaymentRequestSchema),
    async (c) =>
      ok(
        c,
        await new PaymentReviewService(contextFor(c)).confirm(
          c.req.valid('param').id,
          c.req.valid('json'),
          c.get('principal'),
          requestLanguage(c),
        ),
        { message: 'Payment confirmed' },
      ),
  )
  .post(
    '/:id/reject',
    signedIn,
    requirePlatformPermission('platform.payments.review'),
    validate('param', idParam),
    validate('json', rejectPaymentRequestSchema),
    async (c) => {
      await new PaymentReviewService(contextFor(c)).reject(
        c.req.valid('param').id,
        c.req.valid('json').reason,
        c.get('principal'),
      );
      return ok(c, { status: 'rejected' }, { message: 'Payment rejected' });
    },
  );

/** `/api/v1/platform/subscriptions` — every company's subscription (PLT-14 FR-7). */
export const platformSubscriptionRoutes = new Hono<AppEnv>().get(
  '/',
  signedIn,
  requirePlatformPermission('platform.subscriptions.view'),
  validate('query', z.object({ state: z.enum(SUBSCRIPTION_STATES).optional() })),
  async (c) =>
    ok(
      c,
      await new PaymentReviewService(contextFor(c)).subscriptions(
        c.req.valid('query').state,
        requestLanguage(c),
      ),
    ),
);
