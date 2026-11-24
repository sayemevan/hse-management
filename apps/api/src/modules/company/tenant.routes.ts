import type { TenantDto } from '@hse/shared';
import { Hono } from 'hono';

import type { AppEnv } from '../../core/context/app-context';
import { ok } from '../../core/http/response';
import { logoUrlFor } from './logo-url';

/**
 * `GET /tenant` — public profile of the current subdomain (PLT-02): name, logo and default
 * language only,
 * plus the subscription state when the billing module has loaded it (PLT-11 FR-5). The logo is served by `GET /company/logo` (US-014).
 */
export const tenantRoutes = new Hono<AppEnv>().get('/', (c) => {
  const tenant = c.get('tenant');
  const body: TenantDto =
    tenant.kind === 'platform'
      ? { context: 'platform' }
      : {
          context: 'company',
          company: {
            name: tenant.company.name,
            logoUrl: logoUrlFor(tenant.company.logoFileId),
            defaultLanguage: tenant.company.defaultLanguage,
            timeZone: tenant.company.timeZone,
            subscription: c.get('tenantSubscription') ?? null,
          },
        };
  return ok(c, body);
});
