/**
 * Sync module — public contract (Sprint 9: PLT-29, PLT-30; D-56, D-57).
 *
 * Purpose: the user's own offline conflicts (list, read, resolve; D-20) and the daily
 * maintenance of the sync layer (expired idempotency keys, conflict reminders).
 * Dependencies: identity (sign-in, names), platform/sync, notification, reminders, jobs.
 * Record types register with `registerSyncEntity` (platform/sync) in their own module.
 */
export { syncMaintenanceJob } from './sync.job';
export { syncMeRoutes } from './sync.routes';
