import { generateId, type ProjectDto, type ProjectListItemDto } from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RoleCode } from '../../src/modules/identity';
import { TestClient } from '../support/http';
import { seedCompany, type SeededCompany, seedSubscription, seedUser } from '../support/seed';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;

beforeAll(async () => {
  harness = await startIntegrationEnv();
});
afterAll(async () => {
  await harness.dispose();
});

const DAY_MS = 24 * 60 * 60 * 1000;

async function company(planCode = 'pro'): Promise<SeededCompany> {
  const seeded = await seedCompany(harness.env);
  await seedSubscription(harness.env, seeded.id, { planCode });
  return seeded;
}

async function signedIn(target: SeededCompany, role: RoleCode) {
  const account = await seedUser(harness.env, { companyId: target.id, role });
  const client = new TestClient(harness.env, target.host);
  await client.login(account.email, account.password);
  return { account, client };
}

/** A project role row, as US-008 would write it. */
async function giveProjectRole(
  userId: string,
  target: SeededCompany,
  projectId: string,
  role: RoleCode,
  dates: { from?: number; until?: number } = {},
) {
  await harness.env.DB.prepare(
    `INSERT INTO user_role (id, user_id, role_code, scope_level, company_id, project_id,
       valid_from, valid_until, created_at, updated_at)
     VALUES (?, ?, ?, 'project', ?, ?, ?, ?, 0, 0)`,
  )
    .bind(generateId(), userId, role, target.id, projectId, dates.from ?? null, dates.until ?? null)
    .run();
}

let codeCounter = 0;
function newProject(overrides: Record<string, unknown> = {}) {
  codeCounter += 1;
  return {
    name: 'Riyadh Metro Extension',
    code: `rmx-${String(codeCounter)}`,
    clientName: 'هيئة تطوير الرياض',
    countryCode: 'SA',
    startDate: '2026-12-01',
    expectedEndDate: '2028-06-30',
    ...overrides,
  };
}

async function create(client: TestClient, overrides: Record<string, unknown> = {}) {
  return client.call<ProjectDto>('POST', '/projects', { body: newProject(overrides) });
}

describe('US-016 create project', () => {
  it('creates a project in Planning with the code in capitals', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const result = await create(client, { code: 'rmx-02' });
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({
      code: 'RMX-02',
      status: 'planning',
      acceptsRecords: false,
      codeEditable: true,
      allowedNextStatuses: ['mobilization', 'active'],
    });
    expect(result.body.data.myPermissions).toEqual([
      'projects.archive',
      'projects.edit',
      'projects.members.manage',
      'projects.members.view',
      'projects.status.change',
      'projects.structure.manage',
      'projects.timeline.view',
      'projects.view',
      'projects.workforce.manage',
      'projects.workforce.view',
    ]);
  });

  it('refuses a duplicate code whatever its case', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    expect((await create(client, { code: 'ABC-1' })).status).toBe(201);
    const again = await create(client, { code: 'abc-1' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PROJECT_CODE_TAKEN');
  });

  it('validates the input', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const result = await create(client, { code: 'R', expectedEndDate: '2026-11-01' });
    expect(result.status).toBe(422);
    const paths = result.body.error.details?.map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['code', 'expectedEndDate']));
  });

  it('enforces the plan limit on Basic (1 project) and counts it on the subscription page', async () => {
    const target = await company('basic');
    const { client } = await signedIn(target, 'company_administrator');
    expect((await create(client)).status).toBe(201);
    const second = await create(client);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('PLAN_LIMIT_REACHED');
    const subscription = await client.call<{ usage: { projects: number } }>('GET', '/subscription');
    expect(subscription.body.data.usage.projects).toBe(1);
  });

  it('lets an HSE Director create, but not a Project Manager', async () => {
    const target = await company();
    expect((await create((await signedIn(target, 'hse_director')).client)).status).toBe(201);
    expect((await create((await signedIn(target, 'project_manager')).client)).status).toBe(403);
  });

  it('is refused in read-only mode', async () => {
    const target = await seedCompany(harness.env);
    await seedSubscription(harness.env, target.id, {
      status: 'read_only',
      trialEndsAt: Date.now() - DAY_MS,
    });
    const { client } = await signedIn(target, 'company_administrator');
    const result = await create(client);
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
  });
});

describe('US-016 list and view (PLT-16 project scope)', () => {
  it('shows company-wide roles every project and others only their own', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const alpha = (await create(admin, { name: 'Alpha tower' })).body.data;
    const beta = (await create(admin, { name: 'Beta hospital' })).body.data;

    const { client: manager } = await signedIn(target, 'hse_manager');
    const all = await manager.call<ProjectListItemDto[]>('GET', '/projects');
    expect(all.body.data.map((item) => item.id).sort()).toEqual([alpha.id, beta.id].sort());

    const { account, client: officer } = await signedIn(target, 'safety_officer');
    expect((await officer.call<ProjectListItemDto[]>('GET', '/projects')).body.data).toEqual([]);
    await giveProjectRole(account.id, target, alpha.id, 'safety_officer');
    const own = await officer.call<ProjectListItemDto[]>('GET', '/projects');
    expect(own.body.data.map((item) => item.id)).toEqual([alpha.id]);

    const view = await officer.call<ProjectDto>('GET', `/projects/${alpha.id}`);
    expect(view.status).toBe(200);
    // Sprint 6 defaults (D-47) add members, structure and timeline for Safety Officers;
    // Sprint 7 (D-50) the project workforce.
    expect(view.body.data.myPermissions).toEqual([
      'projects.members.view',
      'projects.structure.manage',
      'projects.timeline.view',
      'projects.view',
      'projects.workforce.manage',
      'projects.workforce.view',
    ]);
    expect(view.body.data.allowedNextStatuses).toEqual([]);
    expect((await officer.call('GET', `/projects/${beta.id}`)).status).toBe(404);
  });

  it('ignores project roles that ended or have not started', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = (await create(admin)).body.data;
    const { account: past, client: pastClient } = await signedIn(target, 'client');
    await giveProjectRole(past.id, target, project.id, 'client', { until: Date.now() - 1000 });
    const { account: future, client: futureClient } = await signedIn(target, 'auditor');
    await giveProjectRole(future.id, target, project.id, 'auditor', { from: Date.now() + DAY_MS });
    expect((await pastClient.call('GET', `/projects/${project.id}`)).status).toBe(404);
    expect((await futureClient.call('GET', `/projects/${project.id}`)).status).toBe(404);
  });

  it("never shows another company's project", async () => {
    const first = await company();
    const second = await company();
    const project = (await create((await signedIn(first, 'company_administrator')).client)).body
      .data;
    const { client } = await signedIn(second, 'company_administrator');
    expect((await client.call('GET', `/projects/${project.id}`)).status).toBe(404);
    expect((await client.call<ProjectListItemDto[]>('GET', '/projects')).body.data).toEqual([]);
  });

  it('searches name, code and Arabic client name, and hides archived by default', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    await create(client, { name: 'Hospital wing', code: 'HSP-1', clientName: 'وزارة الصحة' });
    await create(client, { name: 'Airport', code: 'APT-9', clientName: 'Matarat' });
    const byClient = await client.call<ProjectListItemDto[]>(
      'GET',
      `/projects?search=${encodeURIComponent('الصحة')}`,
    );
    expect(byClient.body.data.map((item) => item.code)).toEqual(['HSP-1']);
    const byCode = await client.call<ProjectListItemDto[]>('GET', '/projects?search=apt');
    expect(byCode.body.data.map((item) => item.code)).toEqual(['APT-9']);
  });
});

describe('US-017 edit and status', () => {
  it('lets the project manager edit their project, and refuses a site engineer', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = (await create(admin)).body.data;
    const { account: pm, client: pmClient } = await signedIn(target, 'project_manager');
    await giveProjectRole(pm.id, target, project.id, 'project_manager');
    const saved = await pmClient.call<ProjectDto>('PATCH', `/projects/${project.id}`, {
      body: { version: project.version, clientName: 'New client' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.clientName).toBe('New client');

    const { account: engineer, client: engineerClient } = await signedIn(target, 'site_engineer');
    await giveProjectRole(engineer.id, target, project.id, 'site_engineer');
    const refused = await engineerClient.call('PATCH', `/projects/${project.id}`, {
      body: { version: saved.body.data.version, clientName: 'Nope' },
    });
    expect(refused.status).toBe(403);
  });

  it('refuses a stale version', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const project = (await create(client)).body.data;
    const first = await client.call<ProjectDto>('PATCH', `/projects/${project.id}`, {
      body: { version: project.version, name: 'First name' },
    });
    expect(first.status).toBe(200);
    const stale = await client.call('PATCH', `/projects/${project.id}`, {
      body: { version: project.version, name: 'Second name' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');
  });

  it('follows the allowed status changes and returns from On Hold', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    let project = (await create(client)).body.data;
    const move = async (status: string) => {
      const result = await client.call<ProjectDto>('POST', `/projects/${project.id}/status`, {
        body: { version: project.version, status, note: 'site update' },
      });
      if (result.status === 200) project = result.body.data;
      return result;
    };
    const refused = await move('completed');
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    expect((await move('mobilization')).status).toBe(200);
    expect(project.acceptsRecords).toBe(true);
    expect((await move('on_hold')).status).toBe(200);
    expect(project.allowedNextStatuses).toEqual(['mobilization']);
    expect((await move('active')).status).toBe(409);
    expect((await move('mobilization')).status).toBe(200);
    expect((await move('active')).status).toBe(200);
    expect((await move('completed')).status).toBe(200);
    expect(project.acceptsRecords).toBe(false);
    expect((await move('active')).status).toBe(200);
  });

  it('locks the code after Planning', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const project = (await create(client)).body.data;
    const renamed = await client.call<ProjectDto>('PATCH', `/projects/${project.id}`, {
      body: { version: project.version, code: 'new-1' },
    });
    expect(renamed.body.data.code).toBe('NEW-1');
    const active = await client.call<ProjectDto>('POST', `/projects/${project.id}/status`, {
      body: { version: renamed.body.data.version, status: 'active' },
    });
    expect(active.body.data.codeEditable).toBe(false);
    const locked = await client.call('PATCH', `/projects/${project.id}`, {
      body: { version: active.body.data.version, code: 'NEW-2' },
    });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('PROJECT_CODE_LOCKED');
  });
});

describe('US-018 archive and restore', () => {
  it('archives read-only, frees a place on Basic, and restores to the previous status', async () => {
    const target = await company('basic');
    const { client } = await signedIn(target, 'company_administrator');
    let project = (await create(client, { status: 'active' })).body.data;
    project = (
      await client.call<ProjectDto>('POST', `/projects/${project.id}/status`, {
        body: { version: project.version, status: 'on_hold' },
      })
    ).body.data;

    const archived = await client.call<ProjectDto>('POST', `/projects/${project.id}/archive`, {
      body: { version: project.version },
    });
    expect(archived.status).toBe(200);
    expect(archived.body.data).toMatchObject({
      status: 'archived',
      statusBeforeArchive: 'on_hold',
      allowedNextStatuses: [],
      acceptsRecords: false,
    });
    expect(archived.body.data.archivedByName).toBe('Test User');

    const edit = await client.call('PATCH', `/projects/${project.id}`, {
      body: { version: archived.body.data.version, name: 'Changed' },
    });
    expect(edit.body.error.code).toBe('PROJECT_ARCHIVED');

    const list = await client.call<ProjectListItemDto[]>('GET', '/projects');
    expect(list.body.data).toEqual([]);
    const archivedList = await client.call<ProjectListItemDto[]>(
      'GET',
      '/projects?status=archived',
    );
    expect(archivedList.body.data).toHaveLength(1);

    const replacement = await create(client);
    expect(replacement.status).toBe(201);
    const blocked = await client.call('POST', `/projects/${project.id}/restore`, {
      body: { version: archived.body.data.version },
    });
    expect(blocked.body.error.code).toBe('PLAN_LIMIT_REACHED');

    await client.call('POST', `/projects/${replacement.body.data.id}/archive`, {
      body: { version: replacement.body.data.version },
    });
    const restored = await client.call<ProjectDto>('POST', `/projects/${project.id}/restore`, {
      body: { version: archived.body.data.version },
    });
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ status: 'on_hold', statusBeforeHold: 'active' });
  });

  it('is for the Company Administrator only by default', async () => {
    const target = await company();
    const project = (await create((await signedIn(target, 'company_administrator')).client)).body
      .data;
    const { client } = await signedIn(target, 'hse_director');
    const result = await client.call('POST', `/projects/${project.id}/archive`, {
      body: { version: project.version },
    });
    expect(result.status).toBe(403);
  });
});
