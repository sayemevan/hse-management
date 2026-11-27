/**
 * Sync probe module — public contract (Sprint 9: PLT-28, O-116; D-56, D-57).
 *
 * Purpose: a small versioned record with photos that proves the offline layer (idempotent
 * creates, updates, photo uploads, conflicts) before inspections exist. **Development and test
 * builds only**: its routes answer `404` elsewhere and its tables are created on first use, never
 * by a migration.
 * Dependencies: identity (sign-in), subscription (storage), platform/audit-log, file-storage, sync.
 */
import { registerSyncEntity } from '../../platform/sync';
import { syncProbeEntity } from './sync-probe.service';

registerSyncEntity(syncProbeEntity);

export { syncProbeRoutes } from './sync-probe.routes';
export { SYNC_PROBE_TYPE } from './sync-probe.service';
