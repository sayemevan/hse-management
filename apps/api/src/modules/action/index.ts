/**
 * Action module — public contract (Sprint 8: PLT-22 – PLT-24, US-053 – US-058; D-52, D-53).
 *
 * Purpose: the one action engine of the platform (Doc 13 §18, T-57). Every corrective,
 * preventive and improvement action, whatever module found the problem, with one owner, a due
 * date, the Open → In Progress → Completed → Verified → Closed workflow (D-12, T-58), evidence,
 * comments and reminders.
 * Dependencies: identity (permissions, audiences, names), project (projects, places, record
 * numbers, the project guard), company (time zones for the daily job), subscription (storage),
 * platform/audit-log, activity, notification, reminders, file-storage, comment.
 * Source modules register an `ActionSource` and create actions with `ActionEngine.prepare` in
 * their own `UnitOfWork`, inside `withActionNumber`. They never read the action tables.
 */
import { registerPlaceUsage } from '../project';
import { ActionRepository } from './action.repository';

// O-112: a place used by any action (voided included) can't be deleted (T-39).
registerPlaceUsage({
  module: 'action',
  countRecordsUsing: (db, placeId) => new ActionRepository(db).countUsingPlace(placeId),
});

export { ActionContext, type ActionDeps } from './action-context';
export { ActionDirectory } from './action-directory';
export {
  ActionEngine,
  type ActionProject,
  type NewAction,
  type PreparedAction,
  withActionNumber,
} from './action-engine';
export { type ActionSource, type ActionSourceRecord, registerActionSource } from './action-sources';
export { actionMeRoutes, projectActionRoutes } from './action.routes';
export { action } from './action.schema';
export { actionDueJob } from './due.job';
