import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../../core/context/app-context';
import { requestHost } from '../../core/http/request-host';
import { createDatabase } from '../../database/client';
import { CompanyDirectory } from './company-directory.service';
import { CompanyRepository } from './company.repository';
import { resolveHost } from './tenant-host';
import { TenantNotFoundError } from './tenant.errors';

export function createCompanyDirectory(c: Context<AppEnv>): CompanyDirectory {
  const { cacheTtlSeconds } = c.get('config').tenancy;
  return new CompanyDirectory(
    new CompanyRepository(createDatabase(c.env.DB)),
    c.env.CACHE,
    cacheTtlSeconds,
    c.get('logger'),
  );
}

/**
 * Resolves the tenant context once per request and stores it as `tenant` (PLT-02).
 * Unknown or inactive companies get 404 before any handler runs.
 */
export const resolveTenant = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const resolution = resolveHost(requestHost(c), c.get('config').tenancy.baseDomain);

    if (resolution.kind === 'platform') {
      c.set('tenant', { kind: 'platform' });
    } else if (resolution.kind === 'company') {
      const company = await createCompanyDirectory(c).findAccessibleBySlug(resolution.slug);
      if (!company) throw new TenantNotFoundError();
      c.set('tenant', { kind: 'company', company });
      c.set('logger', c.get('logger').child({ companyId: company.id }));
    } else {
      throw new TenantNotFoundError();
    }

    await next();
  });
