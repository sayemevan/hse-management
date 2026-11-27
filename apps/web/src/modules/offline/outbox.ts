import { OFFLINE_LIMITS } from '@hse/shared';

import {
  type BlobRow,
  type DeviceConflict,
  deviceStore,
  type OutboxItem,
  type OutboxKind,
  type OutboxRequest,
} from './device-store';

const HOUR_MS = 60 * 60 * 1000;

/** Everything a module gives to queue one change (T-72). */
export interface NewOutboxItem {
  userId: string;
  entityType: string;
  entityId: string;
  kind: OutboxKind;
  label: string;
  projectCode?: string | null;
  request: OutboxRequest;
  /** The item that must sync first, e.g. the record's create before its photos. */
  dependsOn?: number | null;
  blob?: { bytes: ArrayBuffer; type: string; name: string } | null;
  capturedAt?: number;
}

/** Notifies this tab and the others that the queue changed (indicator, sync centre). */
const CHANNEL = 'hse-sync';
type Listener = () => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function broadcast(): void {
  for (const listener of listeners) listener();
  channel?.postMessage('changed');
}

export function onOutboxChange(listener: Listener): () => void {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => {
      for (const each of listeners) each();
    };
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Queues a change; returns its `seq`. The idempotency key is fixed now (T-69). */
export async function enqueue(input: NewOutboxItem, now = Date.now()): Promise<number> {
  const db = await deviceStore();
  if (!db) throw new Error('This browser cannot store data for offline use.');
  let blobId: string | null = null;
  const tx = db.transaction(['outbox', 'blobs'], 'readwrite');
  if (input.blob) {
    blobId = crypto.randomUUID();
    const row: BlobRow = { id: blobId, userId: input.userId, createdAt: now, ...input.blob };
    await tx.objectStore('blobs').put(row);
  }
  const item: OutboxItem = {
    userId: input.userId,
    entityType: input.entityType,
    entityId: input.entityId,
    kind: input.kind,
    label: input.label,
    projectCode: input.projectCode ?? null,
    request: input.request,
    idempotencyKey: crypto.randomUUID(),
    blobId,
    dependsOn: input.dependsOn ?? null,
    state: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    conflictId: null,
    capturedAt: input.capturedAt ?? now,
    deviceOffset: -new Date(now).getTimezoneOffset(),
    createdAt: now,
    syncedAt: null,
    result: null,
  };
  const seq = await tx.objectStore('outbox').add(item);
  await tx.done;
  broadcast();
  return seq;
}

export async function listOutbox(userId: string): Promise<OutboxItem[]> {
  const db = await deviceStore();
  const rows = (await db?.getAllFromIndex('outbox', 'byUser', userId)) ?? [];
  return rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export async function getOutboxItem(seq: number): Promise<OutboxItem | undefined> {
  const db = await deviceStore();
  return db?.get('outbox', seq);
}

export async function putOutboxItem(item: OutboxItem): Promise<void> {
  const db = await deviceStore();
  await db?.put('outbox', item);
  broadcast();
}

export async function readBlob(id: string): Promise<BlobRow | undefined> {
  const db = await deviceStore();
  return db?.get('blobs', id);
}

/** Does anyone else's queue wait on this device? (sign-in page notice, PLT-27 FR-7) */
export async function otherUsersWaiting(userId: string | null): Promise<boolean> {
  const db = await deviceStore();
  const rows = (await db?.getAll('outbox')) ?? [];
  return rows.some((row) => row.state !== 'synced' && row.userId !== userId);
}

/** The items that depend on `seq`, directly or through others. */
export function dependentsOf(items: OutboxItem[], seq: number): OutboxItem[] {
  const result: OutboxItem[] = [];
  const wanted = new Set([seq]);
  for (const item of items) {
    if (item.dependsOn !== null && wanted.has(item.dependsOn) && item.seq !== undefined) {
      result.push(item);
      wanted.add(item.seq);
    }
  }
  return result;
}

/** PLT-31: removes an item the server never accepted, its dependents and their photos. */
export async function discard(userId: string, seq: number): Promise<number> {
  const db = await deviceStore();
  if (!db) return 0;
  const items = await listOutbox(userId);
  const target = items.find((item) => item.seq === seq);
  if (!target || target.state === 'synced') return 0;
  const doomed = [target, ...dependentsOf(items, seq)];
  const tx = db.transaction(['outbox', 'blobs', 'conflicts'], 'readwrite');
  for (const item of doomed) {
    if (item.seq !== undefined) await tx.objectStore('outbox').delete(item.seq);
    if (item.blobId) await tx.objectStore('blobs').delete(item.blobId);
    if (item.conflictId) await tx.objectStore('conflicts').delete([userId, item.conflictId]);
  }
  await tx.done;
  broadcast();
  return doomed.length;
}

/** O-119 "Discard and sign out": everything of this user that the server never received. */
export async function discardAll(userId: string): Promise<number> {
  const db = await deviceStore();
  if (!db) return 0;
  const items = await listOutbox(userId);
  const tx = db.transaction(['outbox', 'blobs', 'conflicts', 'drafts'], 'readwrite');
  let removed = 0;
  for (const item of items) {
    if (item.seq !== undefined) await tx.objectStore('outbox').delete(item.seq);
    if (item.blobId) await tx.objectStore('blobs').delete(item.blobId);
    if (item.state !== 'synced') removed += 1;
  }
  for (const key of await tx.objectStore('conflicts').index('byUser').getAllKeys(userId)) {
    await tx.objectStore('conflicts').delete(key);
  }
  for (const key of await tx.objectStore('drafts').index('byUser').getAllKeys(userId)) {
    await tx.objectStore('drafts').delete(key);
  }
  await tx.done;
  broadcast();
  return removed;
}

/** O-120: synced items (and their photos) leave the device after 24 hours. */
export async function pruneSynced(userId: string, now = Date.now()): Promise<number> {
  const db = await deviceStore();
  if (!db) return 0;
  const limit = now - OFFLINE_LIMITS.syncedRetentionHours * HOUR_MS;
  const items = (await listOutbox(userId)).filter(
    (item) => item.state === 'synced' && (item.syncedAt ?? now) <= limit,
  );
  if (items.length === 0) return 0;
  const tx = db.transaction(['outbox', 'blobs'], 'readwrite');
  for (const item of items) {
    if (item.seq !== undefined) await tx.objectStore('outbox').delete(item.seq);
    if (item.blobId) await tx.objectStore('blobs').delete(item.blobId);
  }
  await tx.done;
  broadcast();
  return items.length;
}

// ---- device copies of conflicts (PLT-30) ----------------------------------------------------

export async function saveDeviceConflict(row: DeviceConflict): Promise<void> {
  const db = await deviceStore();
  await db?.put('conflicts', row);
  broadcast();
}

export async function listDeviceConflicts(userId: string): Promise<DeviceConflict[]> {
  const db = await deviceStore();
  return (await db?.getAllFromIndex('conflicts', 'byUser', userId)) ?? [];
}

export async function removeDeviceConflict(userId: string, conflictId: string): Promise<void> {
  const db = await deviceStore();
  await db?.delete('conflicts', [userId, conflictId]);
  broadcast();
}

/** Counts for the indicator (PLT-31). */
export interface OutboxCounts {
  pending: number;
  attention: number;
  conflicts: number;
  waitingSignIn: number;
}

export function countsOf(items: OutboxItem[]): OutboxCounts {
  const counts: OutboxCounts = { pending: 0, attention: 0, conflicts: 0, waitingSignIn: 0 };
  for (const item of items) {
    if (item.state === 'pending' || item.state === 'sending' || item.state === 'waiting_read_only') {
      counts.pending += 1;
    } else if (item.state === 'needs_attention') counts.attention += 1;
    else if (item.state === 'conflict') counts.conflicts += 1;
    else if (item.state === 'waiting_sign_in') counts.waitingSignIn += 1;
  }
  return counts;
}
