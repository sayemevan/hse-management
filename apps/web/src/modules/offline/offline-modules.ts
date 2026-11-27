import { registerInspections } from '@/modules/inspections/inspection-offline';

import { registerSyncProbe } from './dev/sync-probe';

/**
 * T-72: the record types that can be captured offline, registered once on the client.
 * Sprint 9 added the development probe (O-116); Sprint 10 the inspections (T-80).
 */
export function registerOfflineModules(): void {
  registerInspections();
  if (process.env.NODE_ENV !== 'production') registerSyncProbe();
}
