import { companySettingsRequestSchema, updateCompanyRequestSchema } from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import { FILE_CATEGORIES, type FileCategory, type OpenedFile } from '../../platform/file-storage';
import { createCompanyDirectory } from '../company';
import {
  currentAccount,
  loadCompanyPermissions,
  requireCompanyPermission,
  validateIdentitySession,
} from '../identity';
import { CompanyAdminService } from './company-admin.service';

const signedIn = authenticate(validateIdentitySession);

function serviceFor(c: Context<AppEnv>): CompanyAdminService {
  return new CompanyAdminService({
    db: createDatabase(c.env.DB),
    bucket: c.env.FILES,
    directory: createCompanyDirectory(c),
    meta: requestMeta(c),
    logger: c.get('logger'),
    clock: Date.now,
    lifecycle: c.get('config').billing,
  });
}

function tenantCompany(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

/** Streams a stored file with safe headers (PLT-07 FR-6), honouring `If-None-Match`. */
function serveFile(c: Context<AppEnv>, opened: OpenedFile, disposition: 'inline' | 'attachment') {
  const category = FILE_CATEGORIES[opened.row.category as FileCategory] as
    (typeof FILE_CATEGORIES)[FileCategory] | undefined;
  const headers: Record<string, string> = {
    'Content-Type': opened.row.contentType,
    'Content-Disposition': `${disposition}; filename="${opened.row.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': category?.cacheControl ?? 'private, no-store',
    ETag: opened.etag,
  };
  if (c.req.header('if-none-match') === opened.etag) {
    void opened.body.cancel();
    return c.body(null, 304, headers);
  }
  return c.body(opened.body, 200, { ...headers, 'Content-Length': String(opened.row.sizeBytes) });
}

/** `/api/v1/company` — company profile, settings and logo (US-012 – US-015). */
export const companyRoutes = new Hono<AppEnv>()
  // US-015: every user; administrators also get the account summary.
  .get('/', signedIn, requireCompanyPermission('company.view'), async (c) => {
    const company = tenantCompany(c);
    const account = currentAccount(c);
    const permissions = await loadCompanyPermissions(
      createDatabase(c.env.DB),
      account.id,
      company.id,
    );
    const result = await serviceFor(c).information(company, {
      includeAccount: permissions.includes('company.edit'),
      language: account.preferredLanguage ?? company.defaultLanguage,
    });
    return ok(c, result);
  })

  // US-012
  .patch(
    '/',
    signedIn,
    requireCompanyPermission('company.edit'),
    validate('json', updateCompanyRequestSchema),
    async (c) =>
      ok(
        c,
        await serviceFor(c).updateProfile(
          tenantCompany(c),
          c.get('principal'),
          c.req.valid('json'),
        ),
        { message: 'Company details saved' },
      ),
  )

  // US-013
  .get('/settings', signedIn, requireCompanyPermission('company.view'), async (c) =>
    ok(c, await serviceFor(c).getSettings(tenantCompany(c))),
  )
  .put(
    '/settings',
    signedIn,
    requireCompanyPermission('company.settings.edit'),
    validate('json', companySettingsRequestSchema),
    async (c) =>
      ok(
        c,
        await serviceFor(c).updateSettings(
          tenantCompany(c),
          c.get('principal'),
          c.req.valid('json'),
        ),
        { message: 'Preferences saved' },
      ),
  )

  // US-014. Public: the sign-in page shows it before anyone signs in (FR-3).
  .get('/logo', async (c) => {
    const opened = await serviceFor(c).openLogo(tenantCompany(c));
    if (!opened) throw new NotFoundError();
    return serveFile(c, opened, 'inline');
  })
  .put('/logo', signedIn, requireCompanyPermission('company.logo.edit'), async (c) => {
    const form = await c.req.formData().catch(() => null);
    const upload = form?.get('file');
    if (!(upload instanceof File)) {
      throw new ValidationError([{ path: 'file', message: 'required' }]);
    }
    return ok(c, await serviceFor(c).setLogo(tenantCompany(c), c.get('principal'), upload), {
      message: 'Logo saved',
    });
  })
  .delete('/logo', signedIn, requireCompanyPermission('company.logo.edit'), async (c) => {
    await serviceFor(c).removeLogo(tenantCompany(c), c.get('principal'));
    return c.body(null, 204);
  });

/** `/api/v1/files/{id}` — files of the caller's company (PLT-07). Unknown or foreign → 404. */
export const fileRoutes = new Hono<AppEnv>().get(
  '/:id',
  signedIn,
  requireCompanyPermission('company.view'),
  validate('param', z.object({ id: z.uuid() })),
  async (c) => {
    const opened = await serviceFor(c).openFile(tenantCompany(c), c.req.valid('param').id);
    if (!opened) throw new NotFoundError();
    return serveFile(c, opened, 'inline');
  },
);
