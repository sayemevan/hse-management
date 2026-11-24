import { Hono } from 'hono';

import { authenticate } from '../core/auth/authenticate.middleware';
import type { AppEnv } from '../core/context/app-context';
import { ok } from '../core/http/response';
import { createDatabase } from '../database/client';
import { dailyJobs } from '../jobs';
import { requirePlatformPermission, validateIdentitySession } from '../modules/identity';
import { latestJobRuns } from '../platform/jobs';

/** `GET /api/v1/platform/jobs` — the last run of each daily job (PLT-09 FR-7). */
export const platformJobRoutes = new Hono<AppEnv>().get(
  '/',
  authenticate(validateIdentitySession),
  requirePlatformPermission('platform.subscriptions.view'),
  async (c) => ok(c, await latestJobRuns(createDatabase(c.env.DB), dailyJobs.names)),
);
