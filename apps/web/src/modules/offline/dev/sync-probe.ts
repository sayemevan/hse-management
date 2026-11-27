import { SYNC_PROBE_CONFLICT_FIELDS, type SyncProbeDto } from '@hse/shared';

import { deviceStore, type DraftRow } from '../device-store';
import { enqueue } from '../outbox';
import type { CompressedPhoto } from '../photo';
import { registerOfflineEntity } from '../registry';

/**
 * O-116: the sync probe, the development-only record that proves the offline layer before
 * inspections (Sprint 10) exist. It is registered only outside production builds.
 */
export const SYNC_PROBE_TYPE = 'dev.sync_probe';
export const SYNC_PROBE_ROUTE = '/dev/sync-probe';

/** The device copy of a probe (drafts store). */
export interface ProbeCopy {
  id: string;
  title: string;
  note: string;
  /** The server version this copy is based on; 0 while the create waits. */
  version: number;
  photos: number;
  updatedAt: number;
}

function label(title: string): string {
  return `Sync probe ${title}`;
}

export async function listProbeCopies(userId: string): Promise<ProbeCopy[]> {
  const db = await deviceStore();
  const rows = (await db?.getAllFromIndex('drafts', 'byUser', userId)) ?? [];
  return rows
    .filter((row) => row.entityType === SYNC_PROBE_TYPE)
    .map((row) => row.data as ProbeCopy)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function saveCopy(userId: string, copy: ProbeCopy): Promise<void> {
  const db = await deviceStore();
  const row: DraftRow = { userId, entityType: SYNC_PROBE_TYPE, id: copy.id, data: copy, updatedAt: copy.updatedAt };
  await db?.put('drafts', row);
}

async function readCopy(userId: string, id: string): Promise<ProbeCopy | undefined> {
  const db = await deviceStore();
  return (await db?.get('drafts', [userId, SYNC_PROBE_TYPE, id]))?.data as ProbeCopy | undefined;
}

/** Keeps server probes on the device (when online) without losing local edits. */
export async function mergeServerProbes(userId: string, items: SyncProbeDto[]): Promise<void> {
  for (const dto of items) {
    const copy = await readCopy(userId, dto.id);
    if (copy && copy.updatedAt > dto.updatedAt) continue;
    await saveCopy(userId, {
      id: dto.id,
      title: dto.title,
      note: dto.note,
      version: dto.version,
      photos: dto.photoIds.length,
      updatedAt: dto.updatedAt,
    });
  }
}

/** A new probe with its photos: one create, then one upload per photo depending on it (T-68). */
export async function queueProbe(
  userId: string,
  input: { title: string; note: string; photos: CompressedPhoto[] },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await saveCopy(userId, { id, title: input.title, note: input.note, version: 0, photos: input.photos.length, updatedAt: now });
  const create = await enqueue({
    userId,
    entityType: SYNC_PROBE_TYPE,
    entityId: id,
    kind: 'create',
    label: label(input.title),
    request: { method: 'POST', path: '/dev/sync-probes', body: { id, title: input.title, note: input.note }, contractVersion: 1 },
  });
  for (const photo of input.photos) {
    await enqueue({
      userId,
      entityType: SYNC_PROBE_TYPE,
      entityId: id,
      kind: 'upload',
      label: label(input.title),
      dependsOn: create,
      request: { method: 'POST', path: `/dev/sync-probes/${id}/photos`, contractVersion: 1, fileField: 'file' },
      blob: { bytes: photo.bytes, type: photo.type, name: photo.name },
    });
  }
  return id;
}

/** An edit made on this device, applied on top of the version the device knows (T-70). */
export async function queueProbeEdit(
  userId: string,
  id: string,
  values: { title: string; note: string },
): Promise<void> {
  const copy = await readCopy(userId, id);
  if (!copy) return;
  // Only the fields this device changed: an untouched field must not look like a conflict.
  const changed: Record<string, string> = {};
  if (values.title !== copy.title) changed.title = values.title;
  if (values.note !== copy.note) changed.note = values.note;
  if (Object.keys(changed).length === 0) return;
  await saveCopy(userId, { ...copy, ...values, updatedAt: Date.now() });
  await enqueue({
    userId,
    entityType: SYNC_PROBE_TYPE,
    entityId: id,
    kind: 'update',
    label: label(values.title),
    request: {
      method: 'PATCH',
      path: `/dev/sync-probes/${id}`,
      body: { baseVersion: Math.max(copy.version, 1), ...changed },
      baseVersionField: 'baseVersion',
      contractVersion: 1,
    },
  });
}

export function registerSyncProbe(): void {
  registerOfflineEntity({
    type: SYNC_PROBE_TYPE,
    labelKey: 'offline.probe.type',
    routes: [SYNC_PROBE_ROUTE],
    conflictFields: SYNC_PROBE_CONFLICT_FIELDS,
    async fromServer(item) {
      const dto = item.result as SyncProbeDto | null;
      if (!dto || typeof dto.version !== 'number') return;
      const copy = await readCopy(item.userId, item.entityId);
      if (!copy) return;
      await saveCopy(item.userId, { ...copy, version: Math.max(copy.version, dto.version), photos: Math.max(copy.photos, dto.photoIds.length) });
    },
  });
}
