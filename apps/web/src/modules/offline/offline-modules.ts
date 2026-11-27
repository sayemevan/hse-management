import { registerSyncProbe } from './dev/sync-probe';

/**
 * T-72: the record types that can be captured offline, registered once on the client.
 * Sprint 9 has only the development probe (O-116); Sprint 10 adds inspections here.
 */
export function registerOfflineModules(): void {
  if (process.env.NODE_ENV !== 'production') registerSyncProbe();
}
