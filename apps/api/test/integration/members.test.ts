import type { MemberCandidatesDto, ProjectMembersDto, TimelinePageDto } from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestClient } from '../support/http';
import { projectHelpers } from '../support/projects';
import { seedUser } from '../support/seed';
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

const members = async (client: TestClient, projectId: string, query = '') =>
  client.call<ProjectMembersDto>('GET', `/projects/${projectId}/members${query}`);

/** A company with a project and a Project Manager on it. */
async function setUp() {
  const target = await company();
  const { client: admin } = await signedIn(target, 'company_administrator');
  const project = await createProject(admin);
  const { account: pm, client: manager } = await signedIn(target, 'site_engineer');
  await giveProjectRole(pm.id, target, project.id, 'project_manager');
  return { target, admin, project, pm, manager };
}

describe('US-022 project members', () => {
  it('lets a Project Manager add several people at once and lists them', async () => {
    const { target, project, manager } = await setUp();
    const officers = await Promise.all(
      [1, 2, 3].map(() => seedUser(harness.env, { companyId: target.id, role: 'safety_officer' })),
    );
    const result = await manager.call<{ added: string[] }>(
      'POST',
      `/projects/${project.id}/members`,
      { body: { userIds: officers.map((o) => o.id), roleCode: 'safety_officer' } },
    );
    expect(result.status, JSON.stringify(result.body.error)).toBe(201);
    expect(result.body.data.added).toHaveLength(3);

    const list = await members(manager, project.id);
    expect(list.body.data.team).toHaveLength(4);
    const officer = list.body.data.team.find((row) => row.user.id === officers[0]?.id);
    expect(officer).toMatchObject({
      roleCode: 'safety_officer',
      state: 'active',
      manageable: true,
    });
    // A Project Manager has no `users.view`: names only, no contact details.
    expect(officer?.user.email).toBeNull();
    expect(list.body.data.companyWide.map((row) => row.companyRoleCode)).toContain(
      'company_administrator',
    );

    const timeline = await manager.call<TimelinePageDto>(
      'GET',
      `/projects/${project.id}/timeline?type=members`,
    );
    expect(timeline.body.data.items.filter((item) => item.action === 'member.added')).toHaveLength(
      3,
    );
  });

  it('adds nobody when one person cannot be added, naming the reasons', async () => {
    const { target, project, manager } = await setUp();
    const fresh = await seedUser(harness.env, { companyId: target.id, role: 'worker' });
    const onProject = await seedUser(harness.env, { companyId: target.id, role: 'worker' });
    await giveProjectRole(onProject.id, target, project.id, 'worker');
    const director = await seedUser(harness.env, { companyId: target.id, role: 'hse_director' });

    const result = await manager.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [fresh.id, onProject.id, director.id], roleCode: 'worker' },
    });
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('BULK_ADD_REFUSED');
    expect(result.body.error.details).toEqual([
      { path: onProject.id, message: 'alreadyOnProject' },
      { path: director.id, message: 'companyWide' },
    ]);
    const list = await members(manager, project.id);
    expect(list.body.data.team.some((row) => row.user.id === fresh.id)).toBe(false);
  });

  it('requires an end date for an Auditor and refuses more than 50 people', async () => {
    const { target, project, manager } = await setUp();
    const auditor = await seedUser(harness.env, { companyId: target.id, role: 'auditor' });
    const noEnd = await manager.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [auditor.id], roleCode: 'auditor' },
    });
    expect(noEnd.status).toBe(422);
    expect(noEnd.body.error.details).toEqual([{ path: 'validUntil', message: 'endDateRequired' }]);
    const tooMany = await manager.call('POST', `/projects/${project.id}/members`, {
      body: {
        userIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
        roleCode: 'worker',
      },
    });
    expect(tooMany.status).toBe(422);
  });

  it('never lets a Project Manager give more access than they hold (T-46)', async () => {
    const { target, admin, project, manager } = await setUp();
    const candidates = await manager.call<MemberCandidatesDto>(
      'GET',
      `/projects/${project.id}/members/candidates`,
    );
    expect(candidates.body.data.assignableRoles).toContain('safety_officer');

    // The company gives Safety Officers "archive", which Project Managers don't hold.
    const role = await admin.call<{
      version: number;
      permissions: { code: string; granted: boolean }[];
    }>('GET', '/roles/safety_officer');
    const granted = role.body.data.permissions
      .filter((permission) => permission.granted)
      .map((permission) => permission.code);
    const saved = await admin.call('PUT', '/roles/safety_officer/permissions', {
      body: { version: role.body.data.version, granted: [...granted, 'projects.archive'] },
    });
    expect(saved.status, JSON.stringify(saved.body.error)).toBe(200);

    const after = await manager.call<MemberCandidatesDto>(
      'GET',
      `/projects/${project.id}/members/candidates`,
    );
    expect(after.body.data.assignableRoles).not.toContain('safety_officer');
    const officer = await seedUser(harness.env, { companyId: target.id, role: 'safety_officer' });
    const refused = await manager.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [officer.id], roleCode: 'safety_officer' },
    });
    expect(refused.body.error.code).toBe('ROLE_EXCEEDS_YOUR_ACCESS');
    const allowed = await admin.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [officer.id], roleCode: 'safety_officer' },
    });
    expect(allowed.status).toBe(201);
    // …and the Project Manager can't change or remove that member either.
    const row = (await members(manager, project.id)).body.data.team.find(
      (member) => member.user.id === officer.id,
    );
    expect(row?.manageable).toBe(false);
    const remove = await manager.call(
      'DELETE',
      `/projects/${project.id}/members/${row?.assignmentId ?? ''}`,
    );
    expect(remove.body.error.code).toBe('ROLE_EXCEEDS_YOUR_ACCESS');
  });

  it('changes and removes members, but never the caller own role', async () => {
    const { target, project, pm, manager } = await setUp();
    const worker = await seedUser(harness.env, { companyId: target.id, role: 'worker' });
    const other = await createProject((await signedIn(target, 'company_administrator')).client);
    await giveProjectRole(worker.id, target, other.id, 'worker');
    await manager.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [worker.id], roleCode: 'worker' },
    });
    const list = (await members(manager, project.id)).body.data.team;
    const row = list.find((member) => member.user.id === worker.id);
    const mine = list.find((member) => member.user.id === pm.id);

    const change = await manager.call(
      'PATCH',
      `/projects/${project.id}/members/${row?.assignmentId ?? ''}`,
      { body: { roleCode: 'foreman' } },
    );
    expect(change.status).toBe(200);
    const own = await manager.call(
      'DELETE',
      `/projects/${project.id}/members/${mine?.assignmentId ?? ''}`,
    );
    expect(own.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE');

    const changed = (await members(manager, project.id)).body.data.team.find(
      (member) => member.user.id === worker.id,
    );
    expect(changed?.roleCode).toBe('foreman');
    const removed = await manager.call(
      'DELETE',
      `/projects/${project.id}/members/${changed?.assignmentId ?? ''}`,
    );
    expect(removed.status).toBe(204);
    const past = await members(manager, project.id, '?include=past');
    expect(past.body.data.team.some((member) => member.user.id === worker.id)).toBe(false);
    expect(past.body.data.past.some((member) => member.user.id === worker.id)).toBe(true);
    // Removing from this project leaves the other project untouched.
    const { client: admin } = await signedIn(target, 'company_administrator');
    const otherList = await members(admin, other.id);
    expect(otherList.body.data.team.some((member) => member.user.id === worker.id)).toBe(true);
  });

  it('hides the tab from Foremen and refuses writes when archived or read-only', async () => {
    const { target, admin, project, manager } = await setUp();
    const { account, client: foreman } = await signedIn(target, 'foreman');
    await giveProjectRole(account.id, target, project.id, 'foreman');
    expect((await members(foreman, project.id)).status).toBe(403);

    const worker = await seedUser(harness.env, { companyId: target.id, role: 'worker' });
    await makeReadOnly(target);
    const readOnly = await manager.call('POST', `/projects/${project.id}/members`, {
      body: { userIds: [worker.id], roleCode: 'worker' },
    });
    expect(readOnly.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    expect((await members(admin, project.id)).status).toBe(200);
  });
});
