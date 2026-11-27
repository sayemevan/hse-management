import type { OfflinePackDto, OfflineProfile, SyncConflictDto, TenantDto } from '@hse/shared';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

/**
 * PLT-26 (T-67): the one device store of the web app, an IndexedDB database per origin (each
 * company subdomain is its own origin). Every row carries `userId`; every read filters by it.
 * Modules never open IndexedDB themselves: they use the helpers of this folder.
 */
export const DEVICE_DB_NAME = 'hse-offline';
export const DEVICE_DB_VERSION = 1;

export type OutboxState =
  | 'pending'
  | 'sending'
  | 'waiting_sign_in'
  | 'waiting_read_only'
  | 'needs_attention'
  | 'conflict'
  | 'synced';

export type OutboxKind = 'create' | 'update' | 'upload' | 'custom';

export interface OutboxRequest {
  method: 'POST' | 'PATCH' | 'PUT';
  path: string;
  /** JSON body (API contract format), or the extra form fields of an upload. */
  body?: Record<string, unknown>;
  /** O-125: the contract the body was written for. */
  contractVersion: number;
  /** A body field updated with the server's new version when an earlier change syncs. */
  baseVersionField?: string;
  /** Uploads: the form field that carries the photo. */
  fileField?: string;
}

export interface OutboxError {
  status: number;
  code: string;
  params?: Record<string, string | number>;
}

export interface OutboxItem {
  seq?: number;
  userId: string;
  entityType: string;
  entityId: string;
  kind: OutboxKind;
  /** What the user sees ("Sync probe Pump check"). */
  label: string;
  projectCode: string | null;
  request: OutboxRequest;
  idempotencyKey: string;
  blobId: string | null;
  dependsOn: number | null;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
  lastError: OutboxError | null;
  conflictId: string | null;
  capturedAt: number;
  /** Minutes east of UTC on the device at capture time (O-129). */
  deviceOffset: number;
  createdAt: number;
  syncedAt: number | null;
  /** The server's answer, for the module's device copy. */
  result: unknown;
}

export interface BlobRow {
  id: string;
  userId: string;
  /** Stored as bytes: Blobs in IndexedDB are unreliable on older iOS. */
  bytes: ArrayBuffer;
  type: string;
  name: string;
  createdAt: number;
}

export interface ReferenceRow {
  userId: string;
  packKey: string;
  scopeId: string;
  data: unknown;
  etag: string | null;
  fetchedAt: number;
}

export interface DraftRow {
  userId: string;
  entityType: string;
  id: string;
  data: unknown;
  updatedAt: number;
}

export interface DeviceConflict {
  userId: string;
  conflictId: string;
  outboxSeq: number | null;
  conflict: SyncConflictDto | null;
  savedAt: number;
}

export interface SessionRow extends OfflineProfile {
  userId: string;
}

interface OfflineDb extends DBSchema {
  meta: { key: string; value: { key: string; value: unknown } };
  session: { key: string; value: SessionRow };
  reference: {
    key: [string, string, string];
    value: ReferenceRow;
    indexes: { byUser: string };
  };
  drafts: { key: [string, string, string]; value: DraftRow; indexes: { byUser: string } };
  outbox: {
    key: number;
    value: OutboxItem;
    indexes: { byUser: string; byEntity: [string, string] };
  };
  blobs: { key: string; value: BlobRow; indexes: { byUser: string } };
  conflicts: { key: [string, string]; value: DeviceConflict; indexes: { byUser: string } };
}

export type DeviceDb = IDBPDatabase<OfflineDb>;

let opening: Promise<DeviceDb | null> | null = null;

/** Versioned upgrades (PLT-26 FR-1). Add a `case` per version; never change an old one. */
function upgrade(db: IDBPDatabase<OfflineDb>, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('session', { keyPath: 'userId' });
    db.createObjectStore('reference', { keyPath: ['userId', 'packKey', 'scopeId'] }).createIndex(
      'byUser',
      'userId',
    );
    db.createObjectStore('drafts', { keyPath: ['userId', 'entityType', 'id'] }).createIndex(
      'byUser',
      'userId',
    );
    const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    outbox.createIndex('byUser', 'userId');
    outbox.createIndex('byEntity', ['userId', 'entityId']);
    db.createObjectStore('blobs', { keyPath: 'id' }).createIndex('byUser', 'userId');
    db.createObjectStore('conflicts', { keyPath: ['userId', 'conflictId'] }).createIndex(
      'byUser',
      'userId',
    );
  }
}

/** The device store, or `null` where the browser can't keep data (private mode, old browser). */
export function deviceStore(): Promise<DeviceDb | null> {
  opening ??= (async () => {
    if (typeof indexedDB === 'undefined') return null;
    try {
      return await openDB<OfflineDb>(DEVICE_DB_NAME, DEVICE_DB_VERSION, {
        upgrade: (db, oldVersion) => {
          upgrade(db, oldVersion);
        },
        blocked: () => undefined,
        terminated: () => {
          opening = null;
        },
      });
    } catch {
      return null;
    }
  })();
  return opening;
}

/** Tests: forget the open connection (after replacing `indexedDB`). */
export function resetDeviceStore(): void {
  opening = null;
}

// ---- meta ---------------------------------------------------------------------------------

export async function readMeta<T>(key: string): Promise<T | undefined> {
  const db = await deviceStore();
  const row = await db?.get('meta', key);
  return row?.value as T | undefined;
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  const db = await deviceStore();
  await db?.put('meta', { key, value });
}

/** A random id per installation (O-130), not a hardware id. */
export async function deviceId(): Promise<string> {
  const existing = await readMeta<string>('deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  await writeMeta('deviceId', id);
  return id;
}

/** The public tenant profile, so the app can start offline (PLT-27). Not personal data. */
export async function cacheTenant(tenant: TenantDto): Promise<void> {
  await writeMeta('tenant', tenant);
}

export function cachedTenant(): Promise<TenantDto | undefined> {
  return readMeta<TenantDto>('tenant');
}

// ---- reference packs ----------------------------------------------------------------------

export async function readReference<T>(
  userId: string,
  packKey: string,
  scopeId: string,
): Promise<(ReferenceRow & { data: T }) | undefined> {
  const db = await deviceStore();
  return (await db?.get('reference', [userId, packKey, scopeId])) as
    | (ReferenceRow & { data: T })
    | undefined;
}

export async function writeReference(row: ReferenceRow): Promise<void> {
  const db = await deviceStore();
  await db?.put('reference', row);
}

export async function listReferences(userId: string): Promise<ReferenceRow[]> {
  const db = await deviceStore();
  return (await db?.getAllFromIndex('reference', 'byUser', userId)) ?? [];
}

export async function deleteReference(userId: string, packKey: string, scopeId: string) {
  const db = await deviceStore();
  await db?.delete('reference', [userId, packKey, scopeId]);
}

export type ProjectPack = OfflinePackDto;
