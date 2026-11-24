/**
 * Company module — public contract.
 *
 * Sprint 1: tenant resolution from subdomain (PLT-02). Sprint 2: company creation on
 * approval (CompanyProvisioning). Sprint 3: profile and settings.
 *
 * `company` (the table) is exported for foreign-key references only. Other modules must
 * never query it; they use `CompanyDirectory` or the tenant context instead.
 */
export { CompanyDirectory } from './company-directory.service';
export { CompanyProvisioning } from './company-provisioning.service';
export type { CompanyProfileUpdate, NewCompany } from './company.repository';
export { requireCompanyContext } from './company-context.middleware';
export { CompanyChangedError, CompanyReadOnlyError } from './company.errors';
export {
  type CompanySettingsValues,
  CompanySettingsRepository,
  toSettingsDto,
} from './company-settings.repository';
export { CompanyRepository } from './company.repository';
export {
  company,
  type CompanyRow,
  companySettings,
  COMPANY_STATUSES,
  type CompanyStatus,
} from './company.schema';
export { logoUrlFor } from './logo-url';
export { resolveHost } from './tenant-host';
export { TenantAccessDeniedError, TenantNotFoundError } from './tenant.errors';
export { requirePlatformContext } from './platform-context.middleware';
export { createCompanyDirectory, resolveTenant } from './tenant.middleware';
export { tenantRoutes } from './tenant.routes';
