import type { AppConfig } from '../../config/config';
import type { TenantContext } from '../../core/context/tenant';
import { companyUrl, platformUrl } from '../../core/http/public-urls';

/**
 * A link on the host the user signs in at (T-17): the company's subdomain, or the base
 * domain for platform users.
 */
export function tenantUrl(config: AppConfig, tenant: TenantContext, path: string): string {
  return tenant.kind === 'company'
    ? companyUrl(config, tenant.company.slug, path)
    : platformUrl(config, path);
}
