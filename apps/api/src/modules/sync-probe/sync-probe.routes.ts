import { createSyncProbeRequestSchema, updateSyncProbeRequestSchema } from '@hse/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { created, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import { FILE_CATEGORIES } from '../../platform/file-storage';
import { idempotencyClaimOf, idempotent, offlineMetaOf } from '../../platform/sync';
import { validateIdentitySession } from '../identity';
import { SyncProbeService } from './sync-probe.service';

const signedIn = authenticate(validateIdentitySession);
const probeParam = z.object({ id: z.uuid() });
const photoParam = probeParam.extend({ fileId: z.uuid() });

function tenantOf(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

function service(c: Context<AppEnv>): SyncProbeService {
  return new SyncProbeService({
    db: createDatabase(c.env.DB),
    meta: requestMeta(c),
    clock: Date.now,
    bucket: c.env.FILES,
  });
}

/** O-116: the probe answers `404` outside development and test, as if it didn't exist. */
const developmentOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const environment = c.get('config').environment;
  if (environment !== 'development' && environment !== 'test') throw new NotFoundError();
  await service(c).ready();
  await next();
};

const replayable = idempotent({
  companyIdOf: (c) => tenantOf(c).id,
  read: (c, id) => service(c).get(tenantOf(c).id, c.get('principal'), id),
});

/** `/api/v1/dev/sync-probes` — PLT-28 (O-116), development and test builds only. */
export const syncProbeRoutes = new Hono<AppEnv>()
  .use('*', developmentOnly)
  .get('/', signedIn, async (c) => ok(c, await service(c).list(tenantOf(c).id, c.get('principal'))))
  .post('/', signedIn, replayable, validate('json', createSyncProbeRequestSchema), async (c) => {
    const result = await service(c).create(
      tenantOf(c).id,
      c.get('principal'),
      c.req.valid('json'),
      idempotencyClaimOf(c),
      offlineMetaOf(c, Date.now()),
    );
    return created(c, result.dto, { message: result.replayed ? 'Already applied' : 'Created' });
  })
  .get('/:id', signedIn, validate('param', probeParam), async (c) =>
    ok(c, await service(c).get(tenantOf(c).id, c.get('principal'), c.req.valid('param').id)),
  )
  .patch(
    '/:id',
    signedIn,
    validate('param', probeParam),
    replayable,
    validate('json', updateSyncProbeRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).update(
          tenantOf(c).id,
          c.get('principal'),
          c.req.valid('param').id,
          c.req.valid('json'),
          idempotencyClaimOf(c),
          offlineMetaOf(c, Date.now()),
        ),
      ),
  )
  .post('/:id/photos', signedIn, validate('param', probeParam), replayable, async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new ValidationError([{ path: 'file', message: 'required' }]);
    return created(
      c,
      await service(c).addPhoto(
        tenantOf(c).id,
        c.get('principal'),
        c.req.valid('param').id,
        file,
        idempotencyClaimOf(c),
        offlineMetaOf(c, Date.now()),
      ),
    );
  })
  .get('/:id/photos/:fileId', signedIn, validate('param', photoParam), async (c) => {
    const { id, fileId } = c.req.valid('param');
    const opened = await service(c).openPhoto(tenantOf(c).id, c.get('principal'), id, fileId);
    if (!opened) throw new NotFoundError();
    return c.body(opened.body, 200, {
      'Content-Type': opened.row.contentType,
      'Content-Length': String(opened.row.sizeBytes),
      'Cache-Control': FILE_CATEGORIES.sync_probe_photo.cacheControl,
      'X-Content-Type-Options': 'nosniff',
      ETag: opened.etag,
    });
  });
