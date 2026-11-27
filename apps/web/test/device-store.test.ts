import { OFFLINE_LIMITS } from '@hse/shared';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { deviceStore, resetDeviceStore, writeMeta } from '../src/modules/offline/device-store';
import { projectsToKeep, usableOfflineProfile } from '../src/modules/offline/offline-profile';
import {
  discard,
  discardAll,
  enqueue,
  listOutbox,
  otherUsersWaiting,
  pruneSynced,
  putOutboxItem,
  readBlob,
} from '../src/modules/offline/outbox';
import { targetSize } from '../src/modules/offline/photo';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDeviceStore();
});

const request = { method: 'POST' as const, path: '/dev/sync-probes', body: { title: 'x' }, contractVersion: 1 };

async function queue(userId: string, entityId = 'a', dependsOn: number | null = null, withBlob = false) {
  return enqueue({
    userId,
    entityType: 'dev.sync_probe',
    entityId,
    kind: withBlob ? 'upload' : 'create',
    label: `Probe ${entityId}`,
    request,
    dependsOn,
    blob: withBlob ? { bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/jpeg', name: 'a.jpg' } : null,
  });
}

describe('device store and outbox (PLT-26, PLT-28)', () => {
  it('keeps each user apart and fixes the idempotency key when queuing', async () => {
    await queue('u1');
    await queue('u2');
    const mine = await listOutbox('u1');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await otherUsersWaiting('u1')).toBe(true);
    expect(await otherUsersWaiting(null)).toBe(true);
  });

  it('discards an item with its dependents and their photos', async () => {
    const create = await queue('u1');
    const photo = await queue('u1', 'a', create, true);
    await queue('u1', 'b');
    const blobId = (await listOutbox('u1')).find((item) => item.seq === photo)?.blobId ?? '';
    expect(await readBlob(blobId)).toBeDefined();

    expect(await discard('u1', create)).toBe(2);
    expect((await listOutbox('u1')).map((item) => item.entityId)).toEqual(['b']);
    expect(await readBlob(blobId)).toBeUndefined();
  });

  it('never discards what the server already has', async () => {
    const seq = await queue('u1');
    const item = (await listOutbox('u1'))[0];
    if (!item) throw new Error('missing');
    await putOutboxItem({ ...item, state: 'synced', syncedAt: Date.now() });
    expect(await discard('u1', seq)).toBe(0);
  });

  it('discards everything of one user on "Discard and sign out" (O-119)', async () => {
    await queue('u1');
    await queue('u1', 'b', null, true);
    await queue('u2');
    expect(await discardAll('u1')).toBe(2);
    expect(await listOutbox('u1')).toHaveLength(0);
    expect(await listOutbox('u2')).toHaveLength(1);
  });

  it('removes synced items after 24 hours (O-120)', async () => {
    await queue('u1');
    const item = (await listOutbox('u1'))[0];
    if (!item) throw new Error('missing');
    const now = Date.now();
    await putOutboxItem({ ...item, state: 'synced', syncedAt: now });
    expect(await pruneSynced('u1', now + 23 * 60 * 60 * 1000)).toBe(0);
    expect(await pruneSynced('u1', now + 25 * 60 * 60 * 1000)).toBe(1);
  });

  it('stores no token or password (T-73)', async () => {
    await queue('u1');
    const db = await deviceStore();
    const everything = JSON.stringify({
      meta: await db?.getAll('meta'),
      session: await db?.getAll('session'),
      outbox: await db?.getAll('outbox'),
    });
    expect(everything).not.toMatch(/accessToken|refreshToken|password|Bearer/i);
  });
});

describe('offline profile (PLT-27, O-118)', () => {
  it('opens offline only within 7 days of the last online refresh', async () => {
    const db = await deviceStore();
    const savedAt = Date.now();
    await db?.put('session', {
      userId: 'u1',
      user: { id: 'u1', fullName: 'Site Engineer' } as never,
      company: { slug: 'demo', name: 'Demo', timeZone: 'Asia/Riyadh', readOnly: false },
      projects: [],
      generatedAt: savedAt,
      savedAt,
    });
    await writeMeta('lastUserId', 'u1');
    expect((await usableOfflineProfile(savedAt + 6 * DAY_MS))?.user.id).toBe('u1');
    expect(await usableOfflineProfile(savedAt + (OFFLINE_LIMITS.profileMaxAgeDays + 1) * DAY_MS)).toBeNull();
    await writeMeta('lastUserId', null);
    expect(await usableOfflineProfile(savedAt)).toBeNull();
  });

  it('keeps pinned projects first, then the 3 last opened, at most 10', () => {
    const pinned = Array.from({ length: 9 }, (_, i) => `p${String(i)}`);
    expect(projectsToKeep({ pinned, recent: ['r1', 'r2', 'r3'] })).toEqual([...pinned, 'r1']);
    expect(projectsToKeep({ pinned: ['p1'], recent: ['p1', 'r1', 'r2'] })).toEqual(['p1', 'r1', 'r2']);
  });
});

describe('photo size (T-74)', () => {
  it('scales the long edge to 2,560 px and never enlarges', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 2560, height: 1920 });
    expect(targetSize(3000, 4000)).toEqual({ width: 1920, height: 2560 });
    expect(targetSize(1200, 800)).toEqual({ width: 1200, height: 800 });
  });
});
