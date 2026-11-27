import { Hono } from 'hono';

import type { AppEnv } from '../core/context/app-context';
import {
  requireCompanyContext,
  requirePlatformContext,
  resolveTenant,
  tenantRoutes,
} from '../modules/company';
import { projectMemberRoutes, roleRoutes, userAccessRoutes } from '../modules/access';
import {
  enforceSubscriptionAccess,
  platformPaymentRoutes,
  platformSubscriptionRoutes,
  subscriptionRoutes,
} from '../modules/billing';
import { companyRoutes, fileRoutes } from '../modules/company-admin';
import { authRoutes, invitationRoutes, userRoutes } from '../modules/identity';
import { platformRegistrationRoutes, registrationRoutes } from '../modules/registration';
import { notificationRoutes } from '../modules/notifications';
import {
  meRoutes,
  offlinePackRoutes,
  offlineProfileRoutes,
  projectRoutes,
} from '../modules/project';
import { planRoutes } from '../modules/subscription';
import { projectWorkforceRoutes, workforceMeRoutes, workforceRoutes } from '../modules/workforce';
import { actionMeRoutes, projectActionRoutes } from '../modules/action';
import { syncMeRoutes } from '../modules/sync';
import {
  inspectionCategoryRoutes,
  inspectionMeRoutes,
  inspectionTemplateRoutes,
  projectInspectionRoutes,
} from '../modules/inspection';
import { riskMatrixRoutes } from '../modules/risk';
import {
  projectSafetyEventRoutes,
  safetyEventMeRoutes,
  safetyEventSettingsRoutes,
} from '../modules/safety-event';
import { syncProbeRoutes } from '../modules/sync-probe';
import { healthRoutes } from './health.routes';
import { platformJobRoutes } from './platform-jobs.routes';

export { API_V1_BASE_PATH } from './paths';

/**
 * Version 1 router. The health probe and the plan catalogue are tenant-agnostic; everything
 * else runs inside a resolved tenant context (PLT-02). Registration and the platform console
 * exist only on the base domain; users, invitations, company and files only on a company
 * subdomain. Sprint 4: the subscription page on company subdomains; payments, subscriptions
 * and jobs on the platform console; read-only mode on every company write (PLT-11).
 * Sprint 5: projects, user roles and the roles screen on company subdomains.
 * Sprint 6: places, members and timeline under a project; notifications; `/me` preferences.
 * Sprint 7: the workforce area, a project's Workforce tab and `/me/workforce`.
 * Sprint 8: a project's actions with comments, and `/me/actions`.
 * Sprint 10: inspection categories, templates, a project's inspections, `/me/inspections`.
 * Sprint 11: the risk matrix, safety event settings, a project's safety events, `/me/safety-events`.
 * Sprint 9: the offline profile and pack, the user's sync conflicts, and the sync probe
 * (development and test only, O-116).
 */
export const v1Routes = new Hono<AppEnv>()
  .route('/health', healthRoutes)
  .route('/plans', planRoutes)
  .use('/tenant', resolveTenant())
  .use('/auth/*', resolveTenant())
  .use('/registrations', resolveTenant(), requirePlatformContext())
  .use('/registrations/*', resolveTenant(), requirePlatformContext())
  .use('/platform/*', resolveTenant(), requirePlatformContext())
  // Sprint 3: company subdomains only.
  .use('/users', resolveTenant(), requireCompanyContext())
  .use('/users/*', resolveTenant(), requireCompanyContext())
  .use('/invitations', resolveTenant(), requireCompanyContext())
  .use('/invitations/*', resolveTenant(), requireCompanyContext())
  .use('/company', resolveTenant(), requireCompanyContext())
  .use('/company/*', resolveTenant(), requireCompanyContext())
  .use('/files/*', resolveTenant(), requireCompanyContext())
  // Sprint 4
  .use('/subscription', resolveTenant(), requireCompanyContext())
  .use('/subscription/*', resolveTenant(), requireCompanyContext())
  // Sprint 5
  .use('/projects', resolveTenant(), requireCompanyContext())
  .use('/projects/*', resolveTenant(), requireCompanyContext())
  .use('/roles', resolveTenant(), requireCompanyContext())
  .use('/roles/*', resolveTenant(), requireCompanyContext())
  // Sprint 6
  .use('/notifications', resolveTenant(), requireCompanyContext())
  .use('/notifications/*', resolveTenant(), requireCompanyContext())
  .use('/me/*', resolveTenant(), requireCompanyContext())
  // Sprint 7
  .use('/workforce', resolveTenant(), requireCompanyContext())
  .use('/workforce/*', resolveTenant(), requireCompanyContext())
  // Sprint 10
  .use('/inspection-categories', resolveTenant(), requireCompanyContext())
  .use('/inspection-categories/*', resolveTenant(), requireCompanyContext())
  .use('/inspection-templates', resolveTenant(), requireCompanyContext())
  .use('/inspection-templates/*', resolveTenant(), requireCompanyContext())
  // Sprint 11
  .use('/risk-matrix', resolveTenant(), requireCompanyContext())
  .use('/risk-matrix/*', resolveTenant(), requireCompanyContext())
  .use('/safety-event-settings', resolveTenant(), requireCompanyContext())
  .use('/safety-event-settings/*', resolveTenant(), requireCompanyContext())
  // Sprint 9
  .use('/dev/*', resolveTenant(), requireCompanyContext())
  // PLT-11: after tenant resolution, before every handler. Refuses company writes in
  // read-only mode (allow-list in the billing module) and loads the state for GET /tenant.
  .use('*', enforceSubscriptionAccess())
  .route('/tenant', tenantRoutes)
  .route('/auth', authRoutes)
  .route('/registrations', registrationRoutes)
  .route('/platform/registrations', platformRegistrationRoutes)
  .route('/users', userRoutes)
  .route('/users', userAccessRoutes)
  .route('/invitations', invitationRoutes)
  .route('/company', companyRoutes)
  .route('/files', fileRoutes)
  .route('/subscription', subscriptionRoutes)
  .route('/projects', projectRoutes)
  .route('/projects', projectMemberRoutes)
  .route('/projects', projectWorkforceRoutes)
  .route('/projects', projectActionRoutes)
  .route('/projects', offlinePackRoutes)
  .route('/projects', projectInspectionRoutes)
  .route('/inspection-categories', inspectionCategoryRoutes)
  .route('/inspection-templates', inspectionTemplateRoutes)
  .route('/projects', projectSafetyEventRoutes)
  .route('/risk-matrix', riskMatrixRoutes)
  .route('/safety-event-settings', safetyEventSettingsRoutes)
  .route('/workforce', workforceRoutes)
  .route('/notifications', notificationRoutes)
  .route('/me', meRoutes)
  .route('/me', workforceMeRoutes)
  .route('/me', actionMeRoutes)
  .route('/me', offlineProfileRoutes)
  .route('/me', syncMeRoutes)
  .route('/me', inspectionMeRoutes)
  .route('/me', safetyEventMeRoutes)
  .route('/dev/sync-probes', syncProbeRoutes)
  .route('/roles', roleRoutes)
  .route('/platform/payments', platformPaymentRoutes)
  .route('/platform/subscriptions', platformSubscriptionRoutes)
  .route('/platform/jobs', platformJobRoutes);
