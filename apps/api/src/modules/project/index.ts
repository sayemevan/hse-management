/**
 * Project module — public contract (Sprint 5: US-016 – US-018).
 *
 * Purpose: the company's projects and their lifecycle (Planning → … → Archived, D-13).
 * Dependencies: company (table for the foreign key, tenant), identity (sign-in, permissions,
 * user names), subscription (plan limits), platform/audit-log.
 * Other modules use `ProjectDirectory` (does this project exist here, may it receive records)
 * and `requireProjectPermission` for routes at project scope. `project` (the table) is
 * exported for foreign-key references only.
 */
export { ProjectArchivedError } from './project.errors';
export { RecordNumbers, withRecordNumber } from './record-numbers';
export { recordCounter } from './record-counter.schema';
export { ProjectCounter, ProjectDirectory, type ProjectFacts } from './project-directory';
export { currentProject, requireProjectPermission } from './project-permission';
export { projectRoutes } from './project.routes';
export { meRoutes } from './project-structure.routes';
export { PlaceDirectory, type ResolvedPlace } from './place-directory';
export { type PlaceUsage, registerPlaceUsage } from './place-usage';
export { place, type PlaceRow } from './place.schema';
export { project, type ProjectRow } from './project.schema';
