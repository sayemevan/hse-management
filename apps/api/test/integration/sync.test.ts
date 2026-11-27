import {
  type NotificationPageDto,
  type OfflinePackDto,
  type OfflineProfileDto,
  type ResolveConflictResultDto,
  type SyncConflictDto,
  type SyncConflictSummaryDto,
  type SyncProbeDto,
} from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config';
import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { syncMaintenanceJob } from '../../src/modules/sync';
import type { JobContext } from '../../src/platform/jobs';
import { TestClient } from '../support/http';
import { projectHelpers } from '../support/projects';
import type { SeededCompany } from '../support/seed';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;
const { company, signedIn, createProject, giveProjectRole, makeReadOnly } = projectHelpers(
  () => harness,
);

beforeAll(async () => {
  harness = await startIntegrationEnv();
});
afterAll(async () => {
  await harness.dispose();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

interface Sent<T> {
  status: number;
  replayed: boolean;
  body: { success: boolean; data: T; error?: { code: string; params?: Record<string, unknown> } };
}

/** A request as the sync engine sends it: JSON, `Idempotency-Key`, capture time and device. */
async function send<T>(
  client: TestClient,
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Sent<T>> {
  const response = await client.raw(method, path, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
  return {
    status: response.status,
    replayed: response.headers.get('Idempotent-Replayed') === 'true',
    body: await response.json(),
  };
}

function offline(key: string = crypto.randomUUID(), capturedAt = new Date()): Record<string, string> {
  return {
    'Idempotency-Key': key,
    'X-Captured-At': capturedAt.toISOString(),
    'X-Device-Id': 'device-test-0001',
  };
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const row = await harness.env.DB.prepare(sql)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function createProbe(client: TestClient, title = 'Pump check', headers = offline()) {
  return send<SyncProbeDto>(client, 'POST', '/dev/sync-probes', { title, note: 'All good' }, headers);
}

function jobContext(clock: () => number = Date.now): JobContext {
  return {
    db: createDatabase(harness.env.DB),
    env: harness.env,
    config: loadConfig(harness.env),
    logger: new Logger('error'),
    clock,
    runId: 'test-run',
  };
}

async function user(target?: SeededCompany) {
  const owner = target ?? (await company());
  return { target: owner, ...(await signedIn(owner, 'site_engineer')) };
}

describe('PLT-29 idempotent writes', () => {
  it('applies a create sent twice once and replays the answer', async () => {
    const { client } = await user();
    const headers = offline();
    const first = await createProbe(client, 'Pump check', headers);
    const second = await createProbe(client, 'Pump check', headers);

    expect(first.status).toBe(201);
    expect(first.replayed).toBe(false);
    expect(second.status).toBe(201);
    expect(second.replayed).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await count('SELECT count(*) AS n FROM dev_sync_probe WHERE id = ?', first.body.data.id)).toBe(1);
    expect(
      await count(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'sync_probe.created' AND entity_id = ?",
        first.body.data.id,
      ),
    ).toBe(1);
  });

  it('applies ten parallel copies once', async () => {
    const { client } = await user();
    const headers = offline();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createProbe(client, 'Parallel', headers)),
    );
    const ids = new Set(results.map((result) => result.body.data.id));
    expect(results.every((result) => result.status === 201)).toBe(true);
    expect(ids.size).toBe(1);
    expect(await count('SELECT count(*) AS n FROM dev_sync_probe WHERE id = ?', [...ids][0])).toBe(1);
  });

  it('refuses a reused key with another body, another user, or a key that is not a UUID', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'site_engineer');
    const { client: other } = await signedIn(target, 'site_engineer');
    const key = crypto.randomUUID();
    expect((await createProbe(client, 'First', offline(key))).status).toBe(201);

    const changed = await createProbe(client, 'Changed', offline(key));
    expect(changed.status).toBe(422);
    expect(changed.body.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const stranger = await createProbe(other, 'First', offline(key));
    expect(stranger.status).toBe(422);
    expect(stranger.body.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const invalid = await createProbe(client, 'First', { 'Idempotency-Key': 'not-a-uuid' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('keeps device-made ids and treats the same id from the same user as a replay', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'site_engineer');
    const { client: other } = await signedIn(target, 'site_engineer');
    const id = crypto.randomUUID();
    const first = await send<SyncProbeDto>(client, 'POST', '/dev/sync-probes', { id, title: 'Device id' });
    expect(first.status).toBe(201);
    expect(first.body.data.id).toBe(id);

    const again = await send<SyncProbeDto>(client, 'POST', '/dev/sync-probes', { id, title: 'Device id' });
    expect(again.status).toBe(201);
    expect(await count('SELECT count(*) AS n FROM dev_sync_probe WHERE id = ?', id)).toBe(1);

    const taken = await send(other, 'POST', '/dev/sync-probes', { id, title: 'Someone else' });
    expect(taken.status).toBe(409);
    expect(taken.body.error?.code).toBe('RECORD_ID_TAKEN');
  });

  it('stores a refused request no key, so it can be retried after a fix', async () => {
    const { client } = await user();
    const key = crypto.randomUUID();
    const refused = await send(client, 'POST', '/dev/sync-probes', { title: '' }, offline(key));
    expect(refused.status).toBe(422);
    expect((await createProbe(client, 'Fixed', offline(key))).status).toBe(201);
  });

  it('uploads a photo sent twice once (multipart replay)', async () => {
    const { client } = await user();
    const probe = (await createProbe(client)).body.data;
    const key = crypto.randomUUID();
    const upload = async () => {
      const form = new FormData();
      form.append('file', new File([JPEG], 'photo.jpg', { type: 'image/jpeg' }));
      const response = await client.raw('POST', `/dev/sync-probes/${probe.id}/photos`, {
        body: form,
        headers: offline(key),
      });
      return { status: response.status, replayed: response.headers.get('Idempotent-Replayed') };
    };
    expect((await upload()).status).toBe(201);
    const second = await upload();
    expect(second.status).toBe(201);
    expect(second.replayed).toBe('true');
    expect(await count('SELECT count(*) AS n FROM dev_sync_probe_photo WHERE probe_id = ?', probe.id)).toBe(1);
  });

  it('replaces a capture time more than a day in the future and records the offline facts', async () => {
    const { client } = await user();
    const future = new Date(Date.now() + 3 * DAY_MS);
    const created = await createProbe(client, 'Future clock', offline(crypto.randomUUID(), future));
    expect(created.body.data.capturedAt).toBe(created.body.data.receivedAt);
    const audit = await harness.env.DB.prepare(
      "SELECT new_value AS v FROM audit_log WHERE action = 'sync_probe.created' AND entity_id = ?",
    )
      .bind(created.body.data.id)
      .first<{ v: string }>();
    expect(JSON.parse(audit?.v ?? '{}')).toMatchObject({
      offline: { deviceId: 'device-test-0001', clockAdjusted: true },
    });
  });

  it('removes keys after 30 days', async () => {
    const { client } = await user();
    const key = crypto.randomUUID();
    await createProbe(client, 'Old key', offline(key));
    await syncMaintenanceJob.run(jobContext(() => Date.now() + 31 * DAY_MS));
    expect(await count('SELECT count(*) AS n FROM idempotency_key WHERE key = ?', key)).toBe(0);
  });
});

describe('PLT-30 conflicts', () => {
  async function conflictOn(client: TestClient) {
    const probe = (await createProbe(client, 'Original')).body.data;
    // Someone (here: the same account online, without offline headers) changes it first.
    const online = await send<SyncProbeDto>(client, 'PATCH', `/dev/sync-probes/${probe.id}`, {
      baseVersion: 1,
      title: 'Changed online',
    });
    expect(online.status).toBe(200);
    const stale = await send(
      client,
      'PATCH',
      `/dev/sync-probes/${probe.id}`,
      { baseVersion: 1, note: 'Written offline' },
      offline(),
    );
    return { probe, stale };
  }

  it('applies nothing, keeps both versions and tells the user', async () => {
    const { client } = await user();
    const { probe, stale } = await conflictOn(client);
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('SYNC_CONFLICT');
    const conflictId = String(stale.body.error?.params?.conflictId);

    const current = await client.call<SyncProbeDto>('GET', `/dev/sync-probes/${probe.id}`);
    expect(current.body.data).toMatchObject({ version: 2, note: 'All good', title: 'Changed online' });

    const detail = await client.call<SyncConflictDto>('GET', `/me/sync/conflicts/${conflictId}`);
    expect(detail.body.data).toMatchObject({
      status: 'open',
      baseVersion: 1,
      serverVersion: 2,
      clientPayload: { note: 'Written offline' },
      serverSnapshot: { title: 'Changed online', note: 'All good' },
      fields: ['title', 'note'],
    });
    const list = await client.call<{ items: SyncConflictSummaryDto[] }>('GET', '/me/sync/conflicts');
    expect(list.body.data.items.map((item) => item.id)).toContain(conflictId);

    const bell = await client.call<NotificationPageDto>('GET', '/notifications');
    expect(bell.body.data.items.some((item) => item.type === 'sync.conflict')).toBe(true);
  });

  it('resolves with Keep mine, Keep theirs and Combine', async () => {
    const { client } = await user();

    const mine = await conflictOn(client);
    const mineId = String(mine.stale.body.error?.params?.conflictId);
    const kept = await send<ResolveConflictResultDto>(
      client,
      'POST',
      `/me/sync/conflicts/${mineId}/resolve`,
      { choice: 'mine' },
    );
    expect(kept.status).toBe(200);
    const afterMine = await client.call<SyncProbeDto>('GET', `/dev/sync-probes/${mine.probe.id}`);
    expect(afterMine.body.data).toMatchObject({ version: 3, note: 'Written offline', title: 'Changed online' });

    const theirs = await conflictOn(client);
    const theirsId = String(theirs.stale.body.error?.params?.conflictId);
    const dropped = await send<ResolveConflictResultDto>(
      client,
      'POST',
      `/me/sync/conflicts/${theirsId}/resolve`,
      { choice: 'theirs' },
    );
    expect(dropped.body.data.status).toBe('discarded');
    const afterTheirs = await client.call<SyncProbeDto>('GET', `/dev/sync-probes/${theirs.probe.id}`);
    expect(afterTheirs.body.data).toMatchObject({ version: 2, note: 'All good' });

    const combine = await conflictOn(client);
    const combineId = String(combine.stale.body.error?.params?.conflictId);
    const unknownField = await send(client, 'POST', `/me/sync/conflicts/${combineId}/resolve`, {
      choice: 'combine',
      values: { version: 99 },
    });
    expect(unknownField.status).toBe(422);
    const mixed = await send<ResolveConflictResultDto>(
      client,
      'POST',
      `/me/sync/conflicts/${combineId}/resolve`,
      { choice: 'combine', values: { title: 'Original', note: 'Written offline' } },
    );
    expect(mixed.status).toBe(200);
    const afterCombine = await client.call<SyncProbeDto>('GET', `/dev/sync-probes/${combine.probe.id}`);
    expect(afterCombine.body.data).toMatchObject({ version: 3, title: 'Original', note: 'Written offline' });

    const twice = await send(client, 'POST', `/me/sync/conflicts/${combineId}/resolve`, { choice: 'mine' });
    expect(twice.status).toBe(409);
    expect(twice.body.error?.code).toBe('SYNC_CONFLICT_RESOLVED');

    expect(
      await count(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'sync.conflict_resolved' AND entity_id IN (?, ?, ?)",
        mine.probe.id,
        theirs.probe.id,
        combine.probe.id,
      ),
    ).toBe(3);
  });

  it('opens a new conflict when the record changed again before the resolution', async () => {
    const { client } = await user();
    const { probe, stale } = await conflictOn(client);
    const first = String(stale.body.error?.params?.conflictId);
    await send(client, 'PATCH', `/dev/sync-probes/${probe.id}`, { baseVersion: 2, title: 'Changed again' });

    const resolved = await send(client, 'POST', `/me/sync/conflicts/${first}/resolve`, { choice: 'mine' });
    expect(resolved.status).toBe(409);
    expect(resolved.body.error?.code).toBe('SYNC_CONFLICT');
    const second = String(resolved.body.error?.params?.conflictId);
    expect(second).not.toBe(first);

    const old = await client.call<SyncConflictDto>('GET', `/me/sync/conflicts/${first}`);
    expect(old.body.data.status).toBe('superseded');
    const fresh = await client.call<SyncConflictDto>('GET', `/me/sync/conflicts/${second}`);
    expect(fresh.body.data).toMatchObject({ status: 'open', baseVersion: 2, serverVersion: 3 });
  });

  it('keeps conflicts private and read-only once closed', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'site_engineer');
    const { client: other } = await signedIn(target, 'site_engineer');
    const { stale } = await conflictOn(client);
    const id = String(stale.body.error?.params?.conflictId);
    expect((await other.call('GET', `/me/sync/conflicts/${id}`)).status).toBe(404);
    expect((await send(other, 'POST', `/me/sync/conflicts/${id}/resolve`, { choice: 'theirs' })).status).toBe(404);

    await send(client, 'POST', `/me/sync/conflicts/${id}/resolve`, { choice: 'theirs' });
    await expect(
      harness.env.DB.prepare("UPDATE sync_conflict SET status = 'open' WHERE id = ?").bind(id).run(),
    ).rejects.toThrow(/read-only/);
    await expect(harness.env.DB.prepare('DELETE FROM sync_conflict WHERE id = ?').bind(id).run()).rejects.toThrow(
      /never deleted/,
    );
  });

  it('refuses resolution in read-only mode and keeps the conflict open', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'site_engineer');
    const { stale } = await conflictOn(client);
    const id = String(stale.body.error?.params?.conflictId);
    await makeReadOnly(target);
    const refused = await send(client, 'POST', `/me/sync/conflicts/${id}/resolve`, { choice: 'mine' });
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');
    const detail = await client.call<SyncConflictDto>('GET', `/me/sync/conflicts/${id}`);
    expect(detail.body.data.status).toBe('open');
  });

  it('reminds once after two days', async () => {
    const { client } = await user();
    await conflictOn(client);
    const later = () => Date.now() + 3 * DAY_MS;
    await syncMaintenanceJob.run(jobContext(later));
    await syncMaintenanceJob.run(jobContext(later));
    const items = (await client.call<NotificationPageDto>('GET', '/notifications')).body.data.items;
    expect(items.filter((item) => item.type === 'sync.conflict' && item.params.again)).toHaveLength(1);
  });
});

describe('PLT-26 / PLT-27 offline profile and pack', () => {
  it('lists the projects the user can view with their permissions', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    await createProject(admin);
    const { account, client } = await signedIn(target, 'site_engineer');
    await giveProjectRole(account.id, target, project.id, 'site_engineer');

    const profile = await client.call<OfflineProfileDto>('GET', '/me/offline-profile');
    expect(profile.status).toBe(200);
    expect(profile.body.data.company).toMatchObject({ slug: target.slug, readOnly: false });
    expect(profile.body.data.projects.map((p) => p.id)).toEqual([project.id]);
    expect(profile.body.data.projects[0]?.permissions).toContain('projects.view');
  });

  it('returns a project pack with an ETag, and 404 for a project the user cannot view', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    await admin.call('POST', `/projects/${project.id}/places`, { body: { level: 'area', name: 'Block A' } });
    const { account, client } = await signedIn(target, 'site_engineer');
    await giveProjectRole(account.id, target, project.id, 'site_engineer');

    const first = await client.raw('GET', `/projects/${project.id}/offline-pack`);
    expect(first.status).toBe(200);
    const pack = (await first.json<{ data: OfflinePackDto }>()).data;
    expect(pack.places.areas.map((area) => area.name)).toEqual(['Block A']);
    expect(pack.members.map((member) => member.id)).toContain(account.id);
    const etag = first.headers.get('ETag') ?? '';
    expect(etag).not.toBe('');

    const second = await client.raw('GET', `/projects/${project.id}/offline-pack`, {
      headers: { 'if-none-match': etag },
    });
    expect(second.status).toBe(304);

    const other = await createProject(admin);
    expect((await client.raw('GET', `/projects/${other.id}/offline-pack`)).status).toBe(404);
  });
});

describe('O-116 sync probe outside development', () => {
  it('answers 404 in staging', async () => {
    const target = await company();
    const { account } = await signedIn(target, 'site_engineer');
    const staging = new TestClient(
      {
        ...harness.env,
        APP_ENV: 'staging',
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'test-key',
        BOT_CHECK: 'turnstile',
        TURNSTILE_SECRET_KEY: 'test-secret',
      },
      target.host,
    );
    await staging.login(account.email, account.password);
    expect((await staging.call('GET', '/dev/sync-probes')).status).toBe(404);
  });
});
