import {
  COMPANY_ROLES,
  type CurrentUserDto,
  generateId,
  isCompanyWideRole,
  PERMISSIONS,
  type ProjectDto,
  type RoleDetailDto,
  type RoleSummaryDto,
  type UserDetailDto,
  type UserListItemDto,
  zonedIsoDate,
} from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database/client';
import { PermissionResolver } from '../../src/modules/identity';
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
const today = () => zonedIsoDate(Date.now(), 'Asia/Riyadh');
const inDays = (days: number) => zonedIsoDate(Date.now() + days * DAY_MS, 'Asia/Riyadh');

async function company(): Promise<SeededCompany> {
  const seeded = await seedCompany(harness.env);
  await seedSubscription(harness.env, seeded.id, { planCode: 'enterprise' });
  return seeded;
}

async function signedIn(target: SeededCompany, role: RoleCode) {
  const account = await seedUser(harness.env, { companyId: target.id, role });
  const client = new TestClient(harness.env, target.host);
  await client.login(account.email, account.password);
  return { account, client };
}

let counter = 0;
async function project(admin: TestClient): Promise<ProjectDto> {
  counter += 1;
  const result = await admin.call<ProjectDto>('POST', '/projects', {
    body: {
      name: `Project ${String(counter)}`,
      code: `P-${String(counter)}`,
      clientName: 'Client',
      countryCode: 'SA',
      startDate: '2026-12-01',
    },
  });
  expect(result.status).toBe(201);
  return result.body.data;
}

describe('PLT-16 permission catalogue', () => {
  it('the seeded tables match the shared catalogue exactly', async () => {
    const catalogue = await harness.env.DB.prepare(
      'SELECT code, module, scope_level AS scope FROM permission ORDER BY sort_order',
    ).all<{ code: string; module: string; scope: string }>();
    expect(catalogue.results).toEqual(
      PERMISSIONS.map(({ code, module, scope }) => ({ code, module, scope })),
    );
    const matrix = await harness.env.DB.prepare(
      'SELECT role_code AS role, permission_code AS code FROM role_permission',
    ).all<{ role: string; code: string }>();
    const expected = PERMISSIONS.flatMap((entry) =>
      entry.defaults.map((role) => `${role} ${entry.code}`),
    ).sort();
    expect(matrix.results.map((row) => `${row.role} ${row.code}`).sort()).toEqual(expected);
  });

  it('reports company permissions and the company role on /auth/me', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'hse_director');
    const me = await client.call<CurrentUserDto>('GET', '/auth/me');
    expect(me.body.data.companyRole).toBe('hse_director');
    expect(me.body.data.permissions).toEqual([
      'company.view',
      // Sprint 10 (D-60: O-149)
      'inspections.templates.manage',
      'projects.create',
      'roles.view',
      'users.view',
      // Sprint 7 (D-50: O-73 – O-77)
      'workforce.contacts.view',
      'workforce.lists.manage',
      'workforce.manage',
      'workforce.personal.view',
      'workforce.view',
    ]);
  });
});

describe('PLT-16 default matrix, every role × every permission', () => {
  it('holds at company scope and at project scope', async () => {
    const target = await company();
    const projectId = generateId();
    await harness.env.DB.prepare(
      `INSERT INTO project (id, company_id, code, name, client_name, country_code, start_date,
         status, status_changed_at, created_at, updated_at)
       VALUES (?, ?, 'MATRIX', 'Matrix', 'Client', 'SA', '2026-12-01', 'active', 0, 0, 0)`,
    )
      .bind(projectId, target.id)
      .run();
    const resolver = new PermissionResolver(createDatabase(harness.env.DB));
    for (const role of COMPANY_ROLES) {
      const { id } = await seedUser(harness.env, { companyId: target.id, role });
      const unassigned = await resolver.projectPermissions(id, target.id, projectId);
      if (!isCompanyWideRole(role)) {
        expect(unassigned.size, `${role} without a project role`).toBe(0);
        await harness.env.DB.prepare(
          `INSERT INTO user_role (id, user_id, role_code, scope_level, company_id, project_id,
             created_at, updated_at) VALUES (?, ?, ?, 'project', ?, ?, 0, 0)`,
        )
          .bind(generateId(), id, role, target.id, projectId)
          .run();
      }
      const companyScope = await resolver.companyPermissions(id, target.id);
      const projectScope = await new PermissionResolver(
        createDatabase(harness.env.DB),
      ).projectPermissions(id, target.id, projectId);
      for (const entry of PERMISSIONS) {
        const expected = (entry.defaults as readonly string[]).includes(role);
        if (entry.scope === 'company') {
          expect(companyScope.has(entry.code), `${role} ${entry.code}`).toBe(expected);
        } else if (entry.scope === 'project') {
          expect(projectScope.has(entry.code), `${role} ${entry.code}`).toBe(expected);
        } else {
          expect(companyScope.has(entry.code) || projectScope.has(entry.code)).toBe(false);
        }
      }
    }
  });

  it('denies suspended users and other companies', async () => {
    const target = await company();
    const other = await company();
    const resolver = new PermissionResolver(createDatabase(harness.env.DB));
    const suspended = await seedUser(harness.env, {
      companyId: target.id,
      role: 'company_administrator',
      status: 'suspended',
    });
    expect((await resolver.companyPermissions(suspended.id, target.id)).size).toBe(0);
    const admin = await seedUser(harness.env, {
      companyId: target.id,
      role: 'company_administrator',
    });
    expect((await resolver.companyPermissions(admin.id, other.id)).size).toBe(0);
    expect((await resolver.platformPermissions(admin.id)).size).toBe(0);
  });
});

describe('US-008 role assignment', () => {
  it('changes a company role, effective on the next request', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const p = await project(admin);
    const { account, client: officer } = await signedIn(target, 'safety_officer');
    expect((await officer.call('GET', `/projects/${p.id}`)).status).toBe(404);

    const changed = await admin.call<UserDetailDto>('PUT', `/users/${account.id}/company-role`, {
      body: { roleCode: 'hse_manager' },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.data.companyRole).toBe('hse_manager');
    expect((await officer.call('GET', `/projects/${p.id}`)).status).toBe(200);

    const list = await admin.call<UserListItemDto[]>('GET', '/users');
    expect(list.body.data.find((user) => user.id === account.id)?.roleCodes).toEqual([
      'hse_manager',
    ]);
  });

  it('keeps the last active Company Administrator', async () => {
    const target = await company();
    const { account, client } = await signedIn(target, 'company_administrator');
    const self = await client.call('PUT', `/users/${account.id}/company-role`, {
      body: { roleCode: 'worker' },
    });
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe('LAST_ADMINISTRATOR');

    await seedUser(harness.env, { companyId: target.id, role: 'company_administrator' });
    const now = await client.call('PUT', `/users/${account.id}/company-role`, {
      body: { roleCode: 'worker' },
    });
    expect(now.status).toBe(200);
  });

  it('adds, changes and removes a project role with dates', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const p = await project(admin);
    const { account, client: guest } = await signedIn(target, 'client');

    const missingEnd = await admin.call('POST', `/users/${account.id}/project-roles`, {
      body: { projectId: p.id, roleCode: 'client' },
    });
    expect(missingEnd.status).toBe(422);
    expect(missingEnd.body.error.details?.[0]?.path).toBe('validUntil');

    const added = await admin.call<UserDetailDto>('POST', `/users/${account.id}/project-roles`, {
      body: { projectId: p.id, roleCode: 'client', validUntil: inDays(7) },
    });
    expect(added.status).toBe(201);
    const role = added.body.data.projectRoles[0];
    expect(role).toMatchObject({
      projectCode: p.code,
      roleCode: 'client',
      validFrom: today(),
      validUntil: inDays(7),
      state: 'active',
    });
    expect((await guest.call('GET', `/projects/${p.id}`)).status).toBe(200);

    const duplicate = await admin.call('POST', `/users/${account.id}/project-roles`, {
      body: { projectId: p.id, roleCode: 'consultant', validUntil: inDays(3) },
    });
    expect(duplicate.status).toBe(409);

    const changed = await admin.call<UserDetailDto>(
      'PATCH',
      `/users/${account.id}/project-roles/${role?.id ?? ''}`,
      { body: { validUntil: inDays(30) } },
    );
    expect(changed.status).toBe(200);
    expect(changed.body.data.projectRoles).toHaveLength(1);
    expect(changed.body.data.projectRoles[0]?.validUntil).toBe(inDays(30));

    const current = changed.body.data.projectRoles[0]?.id ?? '';
    const removed = await admin.call('DELETE', `/users/${account.id}/project-roles/${current}`);
    expect(removed.status).toBe(204);
    const detail = await admin.call<UserDetailDto>('GET', `/users/${account.id}`);
    expect(detail.body.data.projectRoles).toEqual([]);
    expect(detail.body.data.pastProjectRoles.length).toBeGreaterThanOrEqual(1);
    expect((await guest.call('GET', `/projects/${p.id}`)).status).toBe(404);
  });

  it('schedules a project role that starts later', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const p = await project(admin);
    const { account, client: officer } = await signedIn(target, 'safety_officer');
    const added = await admin.call<UserDetailDto>('POST', `/users/${account.id}/project-roles`, {
      body: { projectId: p.id, roleCode: 'safety_officer', validFrom: inDays(2) },
    });
    expect(added.body.data.projectRoles[0]?.state).toBe('scheduled');
    expect((await officer.call('GET', `/projects/${p.id}`)).status).toBe(404);
  });

  it('refuses company-wide roles on a project, archived projects and outsiders', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const p = await project(admin);
    const { account } = await signedIn(target, 'worker');
    const wrongRole = await admin.call('POST', `/users/${account.id}/project-roles`, {
      body: { projectId: p.id, roleCode: 'company_administrator' },
    });
    expect(wrongRole.status).toBe(422);

    await admin.call('POST', `/projects/${p.id}/archive`, { body: { version: p.version } });
    const archived = await admin.call('POST', `/users/${account.id}/project-roles`, {
      body: { projectId: p.id, roleCode: 'worker' },
    });
    expect(archived.body.error.code).toBe('PROJECT_ARCHIVED');

    const other = await company();
    const { account: stranger } = await signedIn(other, 'worker');
    expect((await admin.call('GET', `/users/${stranger.id}`)).status).toBe(404);
  });

  it('is refused without users.roles.assign', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'hse_director');
    const { account } = await signedIn(target, 'worker');
    expect((await client.call('GET', `/users/${account.id}`)).status).toBe(200);
    const refused = await client.call('PUT', `/users/${account.id}/company-role`, {
      body: { roleCode: 'supervisor' },
    });
    expect(refused.status).toBe(403);
  });
});

describe('US-009 permission assignment', () => {
  it('lists the 13 company roles with user counts', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    await seedUser(harness.env, { companyId: target.id, role: 'foreman' });
    const roles = await client.call<RoleSummaryDto[]>('GET', '/roles');
    expect(roles.body.data).toHaveLength(13);
    expect(roles.body.data.find((role) => role.code === 'foreman')?.userCount).toBe(1);
    expect(roles.body.data.find((role) => role.code === 'hse_manager')?.companyWide).toBe(true);
  });

  it('grants a permission to a role, effective at once, and resets it', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const p = await project(admin);
    const { account: pm, client: pmClient } = await signedIn(target, 'project_manager');
    await admin.call('POST', `/users/${pm.id}/project-roles`, {
      body: { projectId: p.id, roleCode: 'project_manager' },
    });
    const archive = () =>
      pmClient.call('POST', `/projects/${p.id}/archive`, { body: { version: p.version } });
    expect((await archive()).status).toBe(403);

    const role = (await admin.call<RoleDetailDto>('GET', '/roles/project_manager')).body.data;
    expect(role.customised).toBe(false);
    const granted = role.permissions.filter((item) => item.granted).map((item) => item.code);
    const saved = await admin.call<RoleDetailDto>('PUT', '/roles/project_manager/permissions', {
      body: { version: role.version, granted: [...granted, 'projects.archive'] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.customised).toBe(true);
    expect(
      saved.body.data.permissions.find((item) => item.code === 'projects.archive'),
    ).toMatchObject({ granted: true, default: false });

    const stale = await admin.call('PUT', '/roles/project_manager/permissions', {
      body: { version: role.version, granted },
    });
    expect(stale.status).toBe(409);

    const reset = await admin.call<RoleDetailDto>(
      'POST',
      '/roles/project_manager/permissions/reset',
      {
        body: { version: saved.body.data.version },
      },
    );
    expect(reset.body.data.customised).toBe(false);
    expect((await archive()).status).toBe(403);

    await admin.call('PUT', '/roles/project_manager/permissions', {
      body: { version: 0, granted: [...granted, 'projects.archive'] },
    });
    expect((await archive()).status).toBe(200);
  });

  it('turns a permission off for a role', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const { client: director } = await signedIn(target, 'hse_director');
    expect((await director.call('GET', '/users')).status).toBe(200);
    const role = (await admin.call<RoleDetailDto>('GET', '/roles/hse_director')).body.data;
    const granted = role.permissions
      .filter((item) => item.granted && item.code !== 'users.view')
      .map((item) => item.code);
    await admin.call('PUT', '/roles/hse_director/permissions', {
      body: { version: role.version, granted },
    });
    expect((await director.call('GET', '/users')).status).toBe(403);
  });

  it('keeps locked permissions and refuses platform ones', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const role = (await client.call<RoleDetailDto>('GET', '/roles/company_administrator')).body
      .data;
    const without = role.permissions
      .filter((item) => item.granted && item.code !== 'roles.permissions.edit')
      .map((item) => item.code);
    const locked = await client.call('PUT', '/roles/company_administrator/permissions', {
      body: { version: role.version, granted: without },
    });
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe('PERMISSION_LOCKED');

    const platform = await client.call('PUT', '/roles/company_administrator/permissions', {
      body: {
        version: role.version,
        granted: [...role.permissions.map((item) => item.code), 'platform.payments.review'],
      },
    });
    expect(platform.status).toBe(422);
  });

  it('lets an HSE Director view roles but not change them', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'hse_director');
    expect((await client.call('GET', '/roles')).status).toBe(200);
    const refused = await client.call('POST', '/roles/worker/permissions/reset', {
      body: { version: 0 },
    });
    expect(refused.status).toBe(403);
  });

  it('never affects another company', async () => {
    const first = await company();
    const second = await company();
    const { client } = await signedIn(first, 'company_administrator');
    const role = (await client.call<RoleDetailDto>('GET', '/roles/hse_director')).body.data;
    await client.call('PUT', '/roles/hse_director/permissions', {
      body: { version: role.version, granted: ['company.view'] },
    });
    const { client: other } = await signedIn(second, 'hse_director');
    expect((await other.call('GET', '/users')).status).toBe(200);
  });
});
