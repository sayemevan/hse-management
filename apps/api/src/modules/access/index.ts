/**
 * Access administration module — public contract (Sprint 5).
 *
 * Purpose: the Company Administrator's screens for who may do what: a user's company and
 * project roles (US-008) and each role's permissions in the company (US-009).
 * Dependencies: identity (the rules and the role and permission tables), project (whether a
 * project exists in this company, its code and name).
 * It is separate from identity so that identity, which project depends on, never depends on
 * project (the same reason as company-admin in Sprint 3 and billing in Sprint 4).
 */
export { roleRoutes, userAccessRoutes } from './access.routes';
export { projectMemberRoutes } from './member.routes';
export { accessEndingJob, notificationPurgeJob } from './access-ending.job';
