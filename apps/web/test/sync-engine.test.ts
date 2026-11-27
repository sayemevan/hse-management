import { syncBackoffMs } from '@hse/shared';
import { describe, expect, it } from 'vitest';

import type { BlobRow, OutboxItem } from '../src/modules/offline/device-store';
import {
  classify,
  DEPENDENCY_CODE,
  type SendOutcome,
  SyncEngine,
} from '../src/modules/offline/sync-engine';

/** An in-memory outbox and a scripted server. */
function harness(script: (item: OutboxItem) => SendOutcome | Promise<SendOutcome>, start = 1_000_000) {
  let now = start;
  let seq = 0;
  const rows = new Map<number, OutboxItem>();
  const sent: OutboxItem[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const engine = new SyncEngine({
    now: () => now,
    store: {
      list: (userId) =>
        Promise.resolve([...rows.values()].filter((r) => r.userId === userId).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))),
      put: (item) => {
        rows.set(item.seq ?? 0, structuredClone(item));
        return Promise.resolve();
      },
      readBlob: () => Promise.resolve<BlobRow | undefined>(undefined),
    },
    transport: {
      async send(item) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        sent.push(structuredClone(item));
        inFlight -= 1;
        return script(item);
      },
    },
  });
  const add = (partial: Partial<OutboxItem> & { entityId: string }) => {
    seq += 1;
    const item: OutboxItem = {
      seq,
      userId: 'u1',
      entityType: 'dev.sync_probe',
      kind: 'create',
      label: partial.entityId,
      projectCode: null,
      request: { method: 'POST', path: '/x', body: {}, contractVersion: 1 },
      idempotencyKey: `key-${String(seq)}`,
      blobId: null,
      dependsOn: null,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      conflictId: null,
      capturedAt: now,
      deviceOffset: 180,
      createdAt: now,
      syncedAt: null,
      result: null,
      ...partial,
    };
    rows.set(seq, item);
    return seq;
  };
  return {
    engine,
    add,
    rows,
    sent,
    maxInFlight: () => maxInFlight,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

const ok = (data: unknown = { version: 1 }): SendOutcome => ({ kind: 'ok', status: 201, data });

describe('classify (T-71)', () => {
  it('routes every answer class', () => {
    expect(classify(ok())).toBe('synced');
    expect(classify({ kind: 'network' })).toBe('retry');
    expect(classify({ kind: 'http', status: 503, code: 'X' })).toBe('retry');
    expect(classify({ kind: 'http', status: 429, code: 'RATE_LIMITED' })).toBe('retry');
    expect(classify({ kind: 'http', status: 401, code: 'UNAUTHENTICATED' })).toBe('sign_in');
    expect(classify({ kind: 'http', status: 403, code: 'SUBSCRIPTION_READ_ONLY' })).toBe('read_only');
    expect(classify({ kind: 'http', status: 409, code: 'SYNC_CONFLICT' })).toBe('conflict');
    expect(classify({ kind: 'http', status: 422, code: 'VALIDATION_FAILED' })).toBe('attention');
    expect(classify({ kind: 'http', status: 403, code: 'FORBIDDEN' })).toBe('attention');
    expect(classify({ kind: 'http', status: 409, code: 'RECORD_ID_TAKEN' })).toBe('attention');
  });

  it('backs off 5 s, 15 s, 1 min, 5 min, then every 15 min', () => {
    expect([1, 2, 3, 4, 5, 9].map(syncBackoffMs)).toEqual([5_000, 15_000, 60_000, 300_000, 900_000, 900_000]);
  });
});

describe('SyncEngine (PLT-28)', () => {
  it('sends a record create before its photos and records in parallel, at most three', async () => {
    const h = harness(() => ok());
    const createA = h.add({ entityId: 'a' });
    h.add({ entityId: 'a', kind: 'upload', dependsOn: createA });
    h.add({ entityId: 'a', kind: 'upload', dependsOn: createA });
    for (const id of ['b', 'c', 'd', 'e']) h.add({ entityId: id });

    await h.engine.run('u1');

    const order = h.sent.map((item) => `${item.entityId}:${item.kind}`);
    expect(order.indexOf('a:create')).toBeLessThan(order.indexOf('a:upload'));
    expect(h.maxInFlight()).toBeLessThanOrEqual(3);
    expect([...h.rows.values()].every((row) => row.state === 'synced')).toBe(true);
    expect(h.sent).toHaveLength(7);
  });

  it('retries network failures with back-off and keeps the same idempotency key', async () => {
    let fail = true;
    const h = harness(() => (fail ? { kind: 'network' } : ok()));
    const seq = h.add({ entityId: 'a' });
    await h.engine.run('u1');
    expect(h.rows.get(seq)).toMatchObject({ state: 'pending', attempts: 1, nextAttemptAt: h.now() + 5_000 });

    await h.engine.run('u1'); // too early: nothing sent
    expect(h.sent).toHaveLength(1);

    fail = false;
    h.advance(5_000);
    await h.engine.run('u1');
    expect(h.rows.get(seq)?.state).toBe('synced');
    expect(new Set(h.sent.map((item) => item.idempotencyKey)).size).toBe(1);
  });

  it('wake() sends at once after the connection returns', async () => {
    const h = harness(() => ({ kind: 'network' }));
    const seq = h.add({ entityId: 'a' });
    await h.engine.run('u1');
    await h.engine.wake('u1');
    expect(h.rows.get(seq)?.nextAttemptAt).toBe(h.now());
  });

  it('stops for sign-in and resumes for the same user', async () => {
    let signedIn = false;
    const h = harness(() => (signedIn ? ok() : { kind: 'http', status: 401, code: 'SESSION_EXPIRED' }));
    const first = h.add({ entityId: 'a' });
    h.add({ entityId: 'b' });
    const result = await h.engine.run('u1');
    expect(result.needsSignIn).toBe(true);
    expect(h.rows.get(first)?.state).toBe('waiting_sign_in');

    signedIn = true;
    await h.engine.resumeAfterSignIn('u1');
    await h.engine.run('u1');
    expect([...h.rows.values()].every((row) => row.state === 'synced')).toBe(true);
  });

  it('waits on a read-only company and retries later (O-126)', async () => {
    const h = harness(() => ({ kind: 'http', status: 403, code: 'SUBSCRIPTION_READ_ONLY' }));
    const seq = h.add({ entityId: 'a' });
    await h.engine.run('u1');
    expect(h.rows.get(seq)).toMatchObject({ state: 'waiting_read_only', nextAttemptAt: h.now() + 15 * 60_000 });
  });

  it('moves a refused item and its dependents to Needs attention (O-123)', async () => {
    const h = harness((item) =>
      item.kind === 'create' ? { kind: 'http', status: 422, code: 'VALIDATION_FAILED' } : ok(),
    );
    const create = h.add({ entityId: 'a' });
    const photo = h.add({ entityId: 'a', kind: 'upload', dependsOn: create });
    await h.engine.run('u1');
    expect(h.rows.get(create)).toMatchObject({ state: 'needs_attention', lastError: { code: 'VALIDATION_FAILED' } });
    expect(h.rows.get(photo)).toMatchObject({ state: 'needs_attention', lastError: { code: DEPENDENCY_CODE } });
    expect(h.sent).toHaveLength(1);
  });

  it('holds dependents of a conflict and releases them after the resolution', async () => {
    const h = harness((item) =>
      item.kind === 'update'
        ? { kind: 'http', status: 409, code: 'SYNC_CONFLICT', params: { conflictId: 'c-1', serverVersion: 2 } }
        : ok(),
    );
    const update = h.add({ entityId: 'a', kind: 'update' });
    const photo = h.add({ entityId: 'a', kind: 'upload' });
    await h.engine.run('u1');
    expect(h.rows.get(update)).toMatchObject({ state: 'conflict', conflictId: 'c-1' });
    expect(h.rows.get(photo)?.state).toBe('pending');
    expect(h.sent).toHaveLength(1);

    await h.engine.conflictResolved('u1', 'c-1');
    await h.engine.run('u1');
    expect(h.rows.get(photo)?.state).toBe('synced');
  });

  it('applies later edits of the same record on top of the new version', async () => {
    const h = harness((item) => (item.kind === 'create' ? ok({ version: 1 }) : ok({ version: 2 })));
    h.add({ entityId: 'a' });
    const edit = h.add({
      entityId: 'a',
      kind: 'update',
      request: { method: 'PATCH', path: '/x', body: { baseVersion: 0, title: 'x' }, contractVersion: 1, baseVersionField: 'baseVersion' },
    });
    await h.engine.run('u1');
    const sentEdit = h.sent.find((item) => item.seq === edit);
    expect(sentEdit?.request.body).toMatchObject({ baseVersion: 1 });
  });

  it("never reads another user's items", async () => {
    const h = harness(() => ok());
    h.add({ entityId: 'a', userId: 'u2' });
    await h.engine.run('u1');
    expect(h.sent).toHaveLength(0);
  });

  it('resends an item a closed tab left in "sending"', async () => {
    const h = harness(() => ok());
    const seq = h.add({ entityId: 'a', state: 'sending' });
    await h.engine.run('u1');
    expect(h.sent).toHaveLength(0);
    h.advance(3 * 60_000);
    await h.engine.run('u1');
    expect(h.rows.get(seq)?.state).toBe('synced');
  });
});
