/**
 * Company administration module — public contract.
 *
 * Purpose: what a company does with its own account (Sprint 3): profile (US-012), settings
 * (US-013), logo (US-014), the information page (US-015) and file downloads (PLT-07).
 * Dependencies: company (data), identity (sign-in, permissions, user count), subscription
 * (plan), platform/file-storage, platform/audit-log.
 * It is separate from the company module so that the company module, which identity depends
 * on, never depends on identity.
 */
export { companyRoutes, fileRoutes } from './company-admin.routes';
export { CompanyAdminService, toProfileDto } from './company-admin.service';
