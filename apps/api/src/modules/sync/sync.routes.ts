import { conflictListQuerySchema, resolveConflictRequestSchema } from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase, type Database } from '../../database/client';
import { offlineMetaOf, SyncConflictService } from '../../platform/sync';
import { userSummaries, validateIdentitySession } from '../identity';

const signedIn = authenticate(validateIdentitySession);
const conflictParam = z.object({ conflictId: z.uuid() });

function tenantOf(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

function conflicts(c: Context<AppEnv>, db: Database): SyncConflictService {
  return new SyncConflictService(db, requestMeta(c), Date.now);
}

/** `changedBy` is stored as a user id; the screens show the name. */
async function withNames<T extends { changedBy: string | null }>(db: Database, items: T[]): Promise<T[]> {
  const names = await userSummaries(
    db,
    items.flatMap((item) => (item.changedBy ? [item.changedBy] : [])),
  );
  return items.map((item) => ({
    ...item,
    changedBy: item.changedBy ? (names.get(item.changedBy)?.fullName ?? null) : null,
  }));
}

/** `/api/v1/me/sync/conflicts` — PLT-30. Own conflicts only (O-127). */
export const syncMeRoutes = new Hono<AppEnv>()
  .get('/sync/conflicts', signedIn, validate('query', conflictListQuerySchema), async (c) => {
    const db = createDatabase(c.env.DB);
    const page = await conflicts(c, db).list(
      tenantOf(c).id,
      c.get('principal').userId,
      c.req.valid('query').status,
    );
    return ok(c, { items: await withNames(db, page.items) });
  })
  .get('/sync/conflicts/:conflictId', signedIn, validate('param', conflictParam), async (c) => {
    const db = createDatabase(c.env.DB);
    const dto = await conflicts(c, db).get(
      tenantOf(c).id,
      c.get('principal').userId,
      c.req.valid('param').conflictId,
    );
    const [named] = await withNames(db, [dto]);
    return ok(c, named ?? dto);
  })
  .post(
    '/sync/conflicts/:conflictId/resolve',
    signedIn,
    validate('param', conflictParam),
    validate('json', resolveConflictRequestSchema),
    async (c) => {
      const { choice, values } = c.req.valid('json');
      const result = await conflicts(c, createDatabase(c.env.DB)).resolve(
        tenantOf(c).id,
        c.get('principal'),
        c.req.valid('param').conflictId,
        choice,
        values,
        offlineMetaOf(c, Date.now()),
      );
      return ok(c, result, { message: 'Conflict resolved' });
    },
  );
