import type { PlaceDto, PlaceTreeDto, TimelinePageDto } from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/database/client';
import { PlaceDirectory } from '../../src/modules/project';
import type { TestClient } from '../support/http';
import { projectHelpers } from '../support/projects';
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

async function add(
  client: TestClient,
  projectId: string,
  body: Record<string, unknown>,
): Promise<PlaceDto> {
  const result = await client.call<PlaceDto>('POST', `/projects/${projectId}/places`, { body });
  expect(result.status, JSON.stringify(result.body.error)).toBe(201);
  return result.body.data;
}

async function tree(client: TestClient, projectId: string, inactive = false) {
  return (
    await client.call<PlaceTreeDto>(
      'GET',
      `/projects/${projectId}/places${inactive ? '?includeInactive=true' : ''}`,
    )
  ).body.data.areas;
}

describe('US-019 – US-021 project structure', () => {
  it('builds areas, locations and work zones, keeps a manual order and moves places', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    const { account, client: officer } = await signedIn(target, 'safety_officer');
    await giveProjectRole(account.id, target, project.id, 'safety_officer');

    const blockA = await add(officer, project.id, { level: 'area', name: 'Block A', code: 'b-a' });
    expect(blockA.code).toBe('B-A');
    const blockB = await add(officer, project.id, { level: 'area', name: 'Block B' });
    const floor = await add(officer, project.id, {
      level: 'location',
      parentId: blockA.id,
      name: 'Floor 01',
    });
    await add(officer, project.id, { level: 'location', parentId: blockB.id, name: 'Floor 01' });
    await add(officer, project.id, {
      level: 'work_zone',
      parentId: floor.id,
      name: 'Scaffold Zone',
    });

    const move = await officer.call('POST', `/projects/${project.id}/places/${blockB.id}/move`, {
      body: { direction: 'up' },
    });
    expect(move.status).toBe(204);
    const areas = await tree(officer, project.id);
    expect(areas.map((area) => area.name)).toEqual(['Block B', 'Block A']);
    expect(areas[1]?.children[0]?.children[0]?.name).toBe('Scaffold Zone');

    const detail = await officer.call<{ counts: unknown }>('GET', `/projects/${project.id}`);
    expect(detail.body.data.counts).toMatchObject({ areas: 2, locations: 2, workZones: 1 });

    const resolved = await new PlaceDirectory(createDatabase(harness.env.DB)).resolve(
      target.id,
      project.id,
      areas[1]?.children[0]?.children[0]?.id ?? '',
    );
    expect(resolved).toMatchObject({
      areaId: blockA.id,
      locationId: floor.id,
      names: ['Block A', 'Floor 01', 'Scaffold Zone'],
      active: true,
    });
  });

  it('keeps names and codes unique among siblings, inactive ones included', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const project = await createProject(client);
    const area = await add(client, project.id, { level: 'area', name: 'Block A', code: 'BA' });
    await client.call('POST', `/projects/${project.id}/places/${area.id}/deactivate`);

    const sameName = await client.call('POST', `/projects/${project.id}/places`, {
      body: { level: 'area', name: '  block   a ' },
    });
    expect(sameName.status).toBe(409);
    expect(sameName.body.error.code).toBe('PLACE_NAME_TAKEN');
    const sameCode = await client.call('POST', `/projects/${project.id}/places`, {
      body: { level: 'area', name: 'Block C', code: 'ba' },
    });
    expect(sameCode.body.error.code).toBe('PLACE_CODE_TAKEN');
    const badCode = await client.call('POST', `/projects/${project.id}/places`, {
      body: { level: 'area', name: 'Block D', code: 'B A!' },
    });
    expect(badCode.status).toBe(422);
  });

  it('refuses wrong levels, inactive parents and places of another project', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const project = await createProject(client);
    const other = await createProject(client);
    const area = await add(client, project.id, { level: 'area', name: 'Block A' });
    const location = await add(client, project.id, {
      level: 'location',
      parentId: area.id,
      name: 'Basement',
    });

    const zoneUnderArea = await client.call('POST', `/projects/${project.id}/places`, {
      body: { level: 'work_zone', parentId: area.id, name: 'Crane Zone' },
    });
    expect(zoneUnderArea.body.error.code).toBe('PLACE_LEVEL_INVALID');
    const otherProject = await client.call('POST', `/projects/${other.id}/places`, {
      body: { level: 'location', parentId: area.id, name: 'Roof' },
    });
    expect(otherProject.body.error.code).toBe('PLACE_LEVEL_INVALID');
    const foreignId = await client.call('PATCH', `/projects/${other.id}/places/${area.id}`, {
      body: { name: 'Renamed' },
    });
    expect(foreignId.status).toBe(404);

    await client.call('POST', `/projects/${project.id}/places/${area.id}/deactivate`);
    const underInactive = await client.call('POST', `/projects/${project.id}/places`, {
      body: { level: 'location', parentId: area.id, name: 'Roof' },
    });
    expect(underInactive.body.error.code).toBe('PLACE_INACTIVE');
    const reactivateChild = await client.call(
      'POST',
      `/projects/${project.id}/places/${location.id}/reactivate`,
    );
    expect(reactivateChild.body.error.code).toBe('PLACE_INACTIVE');
  });

  it('deactivates with descendants, reactivates one place, deletes only unused leaves', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const project = await createProject(client);
    const area = await add(client, project.id, { level: 'area', name: 'Block A' });
    const location = await add(client, project.id, {
      level: 'location',
      parentId: area.id,
      name: 'Floor 01',
    });
    await add(client, project.id, { level: 'work_zone', parentId: location.id, name: 'Zone 1' });

    const blocked = await client.call('DELETE', `/projects/${project.id}/places/${area.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PLACE_IN_USE');

    const off = await client.call<{ deactivated: number }>(
      'POST',
      `/projects/${project.id}/places/${area.id}/deactivate`,
    );
    expect(off.body.data.deactivated).toBe(3);
    expect(await tree(client, project.id)).toEqual([]);
    const inactive = await tree(client, project.id, true);
    expect(inactive[0]?.active).toBe(false);
    expect(inactive[0]?.children[0]?.active).toBe(false);

    await client.call('POST', `/projects/${project.id}/places/${area.id}/reactivate`);
    const after = await tree(client, project.id, true);
    expect(after[0]?.active).toBe(true);
    expect(after[0]?.children[0]?.active).toBe(false);

    const leaf = await add(client, project.id, { level: 'area', name: 'Warehouse' });
    expect((await client.call('DELETE', `/projects/${project.id}/places/${leaf.id}`)).status).toBe(
      204,
    );
  });

  it('lets viewers read and only managers change; archived and read-only projects refuse', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    await add(admin, project.id, { level: 'area', name: 'Block A' });

    const { account, client: supervisor } = await signedIn(target, 'supervisor');
    await giveProjectRole(account.id, target, project.id, 'supervisor');
    expect((await tree(supervisor, project.id)).length).toBe(1);
    const refused = await supervisor.call('POST', `/projects/${project.id}/places`, {
      body: { level: 'area', name: 'Block B' },
    });
    expect(refused.status).toBe(403);

    const archived = await createProject(admin);
    const fresh = await admin.call<{ version: number }>('GET', `/projects/${archived.id}`);
    await admin.call('POST', `/projects/${archived.id}/archive`, {
      body: { version: fresh.body.data.version },
    });
    const onArchived = await admin.call('POST', `/projects/${archived.id}/places`, {
      body: { level: 'area', name: 'Block A' },
    });
    expect(onArchived.body.error.code).toBe('PROJECT_ARCHIVED');

    await makeReadOnly(target);
    const readOnly = await admin.call('POST', `/projects/${project.id}/places`, {
      body: { level: 'area', name: 'Block C' },
    });
    expect(readOnly.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    expect((await tree(admin, project.id)).length).toBe(1);
  });

  it('writes structure changes on the timeline with old and new values', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const project = await createProject(client);
    const area = await add(client, project.id, { level: 'area', name: 'Block A' });
    await client.call('PATCH', `/projects/${project.id}/places/${area.id}`, {
      body: { name: 'Block A1' },
    });
    const page = await client.call<TimelinePageDto>(
      'GET',
      `/projects/${project.id}/timeline?type=structure`,
    );
    expect(page.body.data.items.map((item) => item.action)).toEqual([
      'place.updated',
      'place.created',
    ]);
    expect(page.body.data.items[0]?.changes).toEqual({
      before: { name: 'Block A' },
      after: { name: 'Block A1' },
    });
  });
});

describe('US-021 place selection (O-56)', () => {
  it('accepts any level with its parents and refuses inconsistent or inactive choices', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'company_administrator');
    const project = await createProject(client);
    const blockA = await add(client, project.id, { level: 'area', name: 'Block A' });
    const blockB = await add(client, project.id, { level: 'area', name: 'Block B' });
    const floor = await add(client, project.id, {
      level: 'location',
      parentId: blockA.id,
      name: 'Floor 01',
    });
    const places = new PlaceDirectory(createDatabase(harness.env.DB));
    const check = (selection: object, options = {}) =>
      places.validateSelection(target.id, project.id, selection, options);

    expect(await check({})).toEqual([]);
    expect(await check({ areaId: blockA.id })).toEqual([]);
    expect(await check({ areaId: blockA.id, locationId: floor.id })).toEqual([]);
    expect(await check({ locationId: floor.id })).toEqual([
      { path: 'locationId', message: 'placeInvalid' },
    ]);
    expect(await check({ areaId: blockB.id, locationId: floor.id })).toEqual([
      { path: 'locationId', message: 'placeInvalid' },
    ]);
    expect(await check({ areaId: blockA.id }, { required: 'location' })).toEqual([
      { path: 'locationId', message: 'placeRequired' },
    ]);

    await client.call('POST', `/projects/${project.id}/places/${blockA.id}/deactivate`);
    expect(await check({ areaId: blockA.id })).toEqual([
      { path: 'areaId', message: 'placeInactive' },
    ]);
    expect(await check({ areaId: blockA.id }, { allowInactiveIds: [blockA.id] })).toEqual([]);
  });
});
