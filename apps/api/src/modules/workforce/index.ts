/**
 * Workforce module — public contract (Sprint 7: US-024 – US-030, PLT-20, PLT-21; D-49, D-50).
 *
 * Purpose: one profile per person who works for or on behalf of the company (T-47), their
 * project assignments, training, certificates, medical fitness, emergency contacts and personal
 * documents, with expiry tracking and reminders.
 * Dependencies: identity (sign-in, permissions, the user link, audiences), project (projects,
 * the project guard), company (time zones for the daily job), subscription (storage limit),
 * platform/audit-log, activity, notification, reminders, file-storage.
 * Other modules use `WorkforceDirectory` (who is this person, are they available and fit for
 * work on this project today) and never read the workforce tables. The tables are exported for
 * foreign-key references only.
 */
export { workforceExpiryJob } from './expiry.job';
export {
  type ResolvedWorkforceMember,
  type WorkforceAvailability,
  WorkforceDirectory,
} from './workforce-directory';
export { projectWorkforceRoutes, workforceMeRoutes, workforceRoutes } from './workforce.routes';
export { workforceAssignment, workforceMember, workforceRecord } from './workforce.schema';
