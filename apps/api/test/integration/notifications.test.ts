import type {
  NotificationOpenDto,
  NotificationPageDto,
  ProjectSwitcherDto,
  TimelinePageDto,
} from '@hse/shared';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database/client';
import { accessEndingJob, notificationPurgeJob } from '../../src/modules/access';
import { loadConfig } from '../../src/config/config';
import { Logger } from '../../src/core/logging/logger';
import type { JobContext } from '../../src/platform/jobs';
import { TestClient } from '../support/http';
import { projectHelpers } from '../support/projects';
import { seedUser, TEST_PASSWORD } from '../support/seed';
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

const inbox = async (client: TestClient) =>
  (await client.call<NotificationPageDto>('GET', '/notifications')).body.data.items;
const unread = async (client: TestClient) =>
  (await client.call<{ count: number }>('GET', '/notifications/unread-count')).body.data.count;

function jobContext(clock: () => number): JobContext {
  return {
    db: createDatabase(harness.env.DB),
    env: harness.env,
    config: loadConfig(harness.env),
    logger: new Logger('error'),
    clock,
    runId: 'test-run',
  };
}

describe('PLT-17 notifications', () => {
  it('tells an added member and the project managers, never the actor', async () => {
    const target = await company();
    const { account: adminAccount, client: admin } = await signedIn(
      target,
      'company_administrator',
    );
    const project = await createProject(admin, { name: 'Riyadh Metro' });
    const { account: pm, client: manager } = await signedIn(target, 'site_engineer');
    await giveProjectRole(pm.id, target, project.id, 'project_manager');
    const { account: officer, client: officerClient } = await signedIn(target, 'safety_officer');

    const added = await admin.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [officer.id], roleCode: 'safety_officer' },
    });
    expect(added.status).toBe(201);

    const mine = await inbox(officerClient);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      type: 'project.member.added',
      params: {
        projectCode: project.code,
        projectName: 'Riyadh Metro',
        roleCode: 'safety_officer',
      },
      readAt: null,
    });
    const managers = await inbox(manager);
    expect(managers.map((row) => row.type)).toEqual(['project.member.joined']);
    expect(managers[0]?.params.memberName).toBe('Test User');
    expect(await inbox(admin)).toEqual([]);
    expect(adminAccount.id).not.toBe(officer.id);

    // Opening marks read and returns the project route.
    const open = await officerClient.call<NotificationOpenDto>(
      'GET',
      `/notifications/${mine[0]?.id ?? ''}/open`,
    );
    expect(open.body.data).toEqual({ route: `/projects/${project.id}`, access: true });
    expect(await unread(officerClient)).toBe(0);
  });

  it('says "no access" when the reader lost access, and keeps notifications private', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    const { account: officer, client: officerClient } = await signedIn(target, 'safety_officer');
    await admin.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [officer.id], roleCode: 'safety_officer' },
    });
    const [note] = await inbox(officerClient);
    const row = (
      await admin.call<{ team: { assignmentId: string; user: { id: string } }[] }>(
        'GET',
        `/projects/${project.id}/members`,
      )
    ).body.data.team.find((member) => member.user.id === officer.id);
    await admin.call('DELETE', `/projects/${project.id}/members/${row?.assignmentId ?? ''}`);

    const open = await officerClient.call<NotificationOpenDto>(
      'GET',
      `/notifications/${note?.id ?? ''}/open`,
    );
    expect(open.body.data).toEqual({ route: null, access: false });
    expect((await inbox(officerClient)).map((item) => item.type)).toEqual([
      'project.member.removed',
      'project.member.added',
    ]);
    // Another user can't see or mark it.
    expect((await admin.call('POST', `/notifications/${note?.id ?? ''}/read`)).status).toBe(404);
  });

  it('tells members about status changes, archive and restore', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    const { account: officer, client: officerClient } = await signedIn(target, 'safety_officer');
    await giveProjectRole(officer.id, target, project.id, 'safety_officer');
    const { client: director } = await signedIn(target, 'hse_director');

    let version = project.version;
    const step = async (path: string, body: Record<string, unknown> = {}) => {
      const result = await admin.call<{ version: number }>(
        'POST',
        `/projects/${project.id}${path}`,
        {
          body: { version, ...body },
        },
      );
      expect(result.status, JSON.stringify(result.body.error)).toBe(200);
      version = result.body.data.version;
    };
    await step('/status', { status: 'on_hold' });
    await step('/archive');
    await step('/restore');

    const types = (await inbox(officerClient)).map((row) => [row.type, row.params.status]);
    expect(types).toEqual([
      ['project.restored', 'on_hold'],
      ['project.archived', 'archived'],
      ['project.status.changed', 'on_hold'],
    ]);
    // Company-wide roles are members of every project (O-45).
    expect(await unread(director)).toBe(3);
  });

  it('notifies administrators of a lock and of edited role permissions', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const { client: otherAdmin } = await signedIn(target, 'company_administrator');
    const victim = await seedUser(harness.env, { companyId: target.id, role: 'worker' });
    const stranger = new TestClient(harness.env, target.host);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await stranger.call('POST', '/auth/login', {
        body: { email: victim.email, password: `${TEST_PASSWORD}-wrong` },
      });
    }
    expect((await inbox(admin)).map((row) => row.type)).toEqual(['user.locked']);

    const role = await admin.call<{ version: number }>('GET', '/roles/worker');
    await admin.call('POST', '/roles/worker/permissions/reset', {
      body: { version: role.body.data.version },
    });
    const types = (await inbox(otherAdmin)).map((row) => row.type);
    expect(types).toEqual(['role.permissions.changed', 'user.locked']);
    expect((await inbox(admin)).map((row) => row.type)).toEqual(['user.locked']);
  });

  it('marks everything read, also in read-only mode, and pages the history', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const { account: officer, client: officerClient } = await signedIn(target, 'safety_officer');
    for (let index = 0; index < 3; index += 1) {
      const project = await createProject(admin);
      await admin.call('POST', `/projects/${project.id}/members`, {
        body: { userIds: [officer.id], roleCode: 'safety_officer' },
      });
    }
    const first = await officerClient.call<NotificationPageDto>('GET', '/notifications?limit=2');
    expect(first.body.data.items).toHaveLength(2);
    const second = await officerClient.call<NotificationPageDto>(
      'GET',
      `/notifications?limit=2&before=${first.body.data.nextBefore ?? ''}`,
    );
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.nextBefore).toBeNull();

    await makeReadOnly(target);
    const all = await officerClient.call<{ marked: number }>('POST', '/notifications/read-all');
    expect(all.status).toBe(200);
    expect(all.body.data.marked).toBe(3);
    expect(await unread(officerClient)).toBe(0);
  });

  it('warns three days before a dated role ends, once, and records the end', async () => {
    const target = await company();
    const { account: adminAccount, client: admin } = await signedIn(
      target,
      'company_administrator',
    );
    const project = await createProject(admin);
    const { account: auditor, client: auditorClient } = await signedIn(target, 'auditor');
    const now = Date.now();
    // Created by the administrator, ending at the start of the day four days from now.
    await harness.env.DB.prepare(
      `INSERT INTO user_role (id, user_id, role_code, scope_level, company_id, project_id,
         valid_from, valid_until, created_by, created_at, updated_at)
       VALUES (?, ?, 'auditor', 'project', ?, ?, NULL, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        auditor.id,
        target.id,
        project.id,
        now + 3 * DAY_MS,
        adminAccount.id,
        now,
        now,
      )
      .run();

    const context = jobContext(() => now);
    await accessEndingJob.run(context);
    await accessEndingJob.run(context);
    const notes = (await inbox(auditorClient)).filter(
      (row) => row.type === 'project.member.access_ending',
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.params.self).toBe(true);
    expect(
      (await inbox(admin)).filter((row) => row.type === 'project.member.access_ending'),
    ).toHaveLength(1);

    await accessEndingJob.run(jobContext(() => now + 4 * DAY_MS));
    const timeline = await admin.call<TimelinePageDto>(
      'GET',
      `/projects/${project.id}/timeline?type=members`,
    );
    expect(timeline.body.data.items.map((item) => item.action)).toContain('member.access_ended');
  });

  it('removes notifications older than a year', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const { account: officer, client: officerClient } = await signedIn(target, 'safety_officer');
    const project = await createProject(admin);
    await admin.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [officer.id], roleCode: 'safety_officer' },
    });
    await notificationPurgeJob.run(jobContext(() => Date.now() + 366 * DAY_MS));
    expect(await inbox(officerClient)).toEqual([]);
  });
});

describe('PLT-18 project timeline', () => {
  it('records project changes with old and new values and refuses edits to entries', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin, { name: 'Tower', city: 'Riyadh' });
    await admin.call('PATCH', `/projects/${project.id}`, {
      body: { version: project.version, name: 'Tower 2', city: 'Jeddah' },
    });
    const page = await admin.call<TimelinePageDto>('GET', `/projects/${project.id}/timeline`);
    const [edit, created] = page.body.data.items;
    expect(created?.action).toBe('project.created');
    expect(edit).toMatchObject({
      action: 'project.updated',
      changes: {
        before: { name: 'Tower', city: 'Riyadh' },
        after: { name: 'Tower 2', city: 'Jeddah' },
      },
    });

    await expect(
      harness.env.DB.prepare('UPDATE activity_entry SET action = ? WHERE id = ?')
        .bind('x', edit?.id ?? '')
        .run(),
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.env.DB.prepare('DELETE FROM activity_entry WHERE id = ?')
        .bind(edit?.id ?? '')
        .run(),
    ).rejects.toThrow(/append-only/);

    const { account, client: supervisor } = await signedIn(target, 'supervisor');
    await giveProjectRole(account.id, target, project.id, 'supervisor');
    expect((await supervisor.call('GET', `/projects/${project.id}/timeline`)).status).toBe(403);
  });
});

describe('T-44 timeline back-fill', () => {
  it('turns Sprint 5 audit entries into timeline entries', async () => {
    const target = await company();
    const { account, client: admin } = await signedIn(target, 'company_administrator');
    const projectId = crypto.randomUUID();
    const memberId = (await seedUser(harness.env, { companyId: target.id, role: 'worker' })).id;
    const db = harness.env.DB;
    await db
      .prepare(
        `INSERT INTO project (id, company_id, code, name, client_name, country_code, start_date,
           status, status_changed_at, created_at, updated_at)
         VALUES (?, ?, 'OLD-1', 'Old project', 'Client', 'SA', '2026-01-01', 'active', 0, 0, 0)`,
      )
      .bind(projectId, target.id)
      .run();
    const audit = (
      id: string,
      action: string,
      at: number,
      entity: string,
      oldV: unknown,
      newV: unknown,
    ) =>
      db
        .prepare(
          `INSERT INTO audit_log (id, occurred_at, actor_user_id, company_id, project_id, action,
             entity_type, entity_id, outcome, old_value, new_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`,
        )
        .bind(
          id,
          at,
          account.id,
          target.id,
          projectId,
          action,
          entity === projectId ? 'project' : 'user',
          entity,
          oldV === null ? null : JSON.stringify(oldV),
          newV === null ? null : JSON.stringify(newV),
        )
        .run();
    await audit(crypto.randomUUID(), 'project.created', 1000, projectId, null, {
      name: 'Old project',
    });
    await audit(
      crypto.randomUUID(),
      'project.status.changed',
      2000,
      projectId,
      { status: 'planning' },
      { status: 'active', note: null },
    );
    await audit(crypto.randomUUID(), 'user.project_role.added', 3000, memberId, null, {
      roleCode: 'worker',
    });

    // The back-fill statements of migration 0009, run again over these rows only.
    const sql = fs
      .readFileSync(
        path.join(import.meta.dirname, '../../migrations/0009_sprint6_seed_triggers_backfill.sql'),
        'utf8',
      )
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.includes('INSERT INTO `activity_entry`'))
      .map(
        (statement) => statement.replace(/;\s*$/, '') + ` AND a.\`project_id\` = '${projectId}'`,
      );
    for (const statement of sql) await db.prepare(statement).run();

    const page = await admin.call<TimelinePageDto>('GET', `/projects/${projectId}/timeline`);
    expect(page.body.data.items.map((item) => item.action)).toEqual([
      'member.added',
      'project.status.changed',
      'project.created',
    ]);
    expect(page.body.data.items[1]?.changes).toEqual({
      before: { status: 'planning' },
      after: { status: 'active', note: null },
    });
    expect(page.body.data.items[0]?.snapshot).toMatchObject({
      memberName: 'Test User',
      roleCode: 'worker',
    });
  });
});

describe('PLT-19 project switcher', () => {
  it('lists viewable, non-archived projects with the last opened first', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const first = await createProject(admin, { code: 'AAA-1' });
    const second = await createProject(admin, { code: 'BBB-1' });
    const third = await createProject(admin, { code: 'CCC-1' });
    const { account, client: officer } = await signedIn(target, 'safety_officer');
    await giveProjectRole(account.id, target, first.id, 'safety_officer');
    await giveProjectRole(account.id, target, second.id, 'safety_officer');

    expect(
      (await officer.call('PUT', '/me/last-project', { body: { projectId: third.id } })).status,
    ).toBe(404);
    expect(
      (await officer.call('PUT', '/me/last-project', { body: { projectId: second.id } })).status,
    ).toBe(204);
    const list = await officer.call<ProjectSwitcherDto>('GET', '/projects/switcher');
    expect(list.body.data.items.map((item) => item.code)).toEqual(['BBB-1', 'AAA-1']);
    expect(list.body.data.lastProjectId).toBe(second.id);

    const all = await admin.call<ProjectSwitcherDto>('GET', '/projects/switcher?search=ccc');
    expect(all.body.data.items.map((item) => item.code)).toEqual(['CCC-1']);
  });
});
