import {
  addIsoDays,
  type MyWorkforceDto,
  type NotificationPageDto,
  type ProjectWorkforcePageDto,
  type TimelinePageDto,
  type WorkforceCandidatesDto,
  type WorkforceDuplicatesDto,
  type WorkforceListDto,
  type WorkforceMemberDto,
  type WorkforcePageDto,
  type WorkforceRecordDto,
  type WorkforceRecordListDto,
  type WorkforceSummaryDto,
  zonedIsoDate,
} from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config';
import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { WorkforceDirectory, workforceExpiryJob } from '../../src/modules/workforce';
import type { JobContext } from '../../src/platform/jobs';
import type { TestClient } from '../support/http';
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

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
]);
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n');

const today = () => zonedIsoDate(Date.now(), 'Asia/Riyadh');

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

async function positions(client: TestClient) {
  const result = await client.call<WorkforceListDto>('GET', '/workforce/lists/job_position');
  expect(result.status).toBe(200);
  return result.body.data.items;
}

async function welderId(client: TestClient): Promise<string> {
  const welder = (await positions(client)).find((item) => item.seedKey === 'welder');
  if (!welder) throw new Error('no welder');
  return welder.id;
}

async function addPerson(
  client: TestClient,
  overrides: Record<string, unknown> = {},
): Promise<WorkforceMemberDto> {
  const result = await client.call<WorkforceMemberDto>('POST', '/workforce', {
    body: {
      category: 'contractor',
      fullName: 'Ahmed Ali',
      altName: 'أحمد علي',
      nationality: 'EG',
      employer: 'Al-Bina Co.',
      jobPositionId: await welderId(client),
      ...overrides,
    },
  });
  expect(result.status, JSON.stringify(result.body.error)).toBe(201);
  return result.body.data;
}

function recordForm(data: Record<string, unknown>, file?: { bytes: Uint8Array; name: string }) {
  const form = new FormData();
  form.set('data', JSON.stringify(data));
  if (file) form.set('file', new File([file.bytes], file.name));
  return form;
}

async function addRecord(
  client: TestClient,
  memberId: string,
  path: string,
  data: Record<string, unknown>,
  file?: { bytes: Uint8Array; name: string },
): Promise<{ status: number; body: { data: WorkforceRecordDto; error?: { code: string } } }> {
  const response = await client.raw('POST', `/workforce/${memberId}/${path}`, {
    body: recordForm(data, file),
  });
  return {
    status: response.status,
    body: await response.json<{ data: WorkforceRecordDto; error?: { code: string } }>(),
  };
}

async function team(target: SeededCompany) {
  const manager = await signedIn(target, 'hse_manager');
  const officer = await signedIn(target, 'safety_officer');
  return { manager, officer };
}

describe('PLT-21 workforce lists', () => {
  it('seeds both lists on first use, adds, renames, refuses duplicates and used deletes', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'hse_manager');
    const items = await positions(client);
    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({ seedKey: 'safety_officer', active: true, usage: 0 });
    const competencies = await client.call<WorkforceListDto>('GET', '/workforce/lists/competency');
    expect(competencies.body.data.items.map((item) => item.seedKey)).toContain('working_at_height');

    const added = await client.call<{ id: string }>('POST', '/workforce/lists/job_position', {
      body: { name: 'Pipe Fitter' },
    });
    expect(added.status).toBe(201);
    const duplicate = await client.call('POST', '/workforce/lists/job_position', {
      body: { name: '  pipe fitter ' },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('LIST_ITEM_NAME_TAKEN');

    const driver = items.find((item) => item.seedKey === 'driver');
    const renamed = await client.call<{ seedKey: string | null; name: string }>(
      'PATCH',
      `/workforce/lists/job_position/${driver?.id ?? ''}`,
      { body: { name: 'Heavy vehicle driver' } },
    );
    expect(renamed.body.data).toMatchObject({ seedKey: null, name: 'Heavy vehicle driver' });
    // Renaming doesn't seed the list again.
    expect(await positions(client)).toHaveLength(11);

    await addPerson(client);
    const welder = await welderId(client);
    const used = await client.call('DELETE', `/workforce/lists/job_position/${welder}`);
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('LIST_ITEM_IN_USE');
    expect(
      (await client.call('DELETE', `/workforce/lists/job_position/${added.body.data.id}`)).status,
    ).toBe(204);

    // Inactive items can't be chosen on new profiles.
    await client.call('POST', `/workforce/lists/job_position/${welder}/deactivate`);
    const refused = await client.call('POST', '/workforce', {
      body: {
        category: 'employee',
        fullName: 'Omar Khan',
        nationality: 'PK',
        employer: 'Main Co.',
        jobPositionId: welder,
      },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('LIST_ITEM_INACTIVE');

    const { client: officer } = await signedIn(target, 'safety_officer');
    expect(
      (await officer.call('POST', '/workforce/lists/job_position', { body: { name: 'Painter' } }))
        .status,
    ).toBe(403);
  });
});

describe('US-024 workforce profiles', () => {
  it('creates, searches in Arabic, warns about duplicates and keeps Employee IDs unique', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'hse_manager');
    const ahmed = await addPerson(client, { employeeId: 'emp-001' });
    expect(ahmed).toMatchObject({
      status: 'active',
      employeeId: 'emp-001',
      compliance: { badge: 'check', medicalMissing: true, noEmergencyContact: true },
      can: { edit: true, viewPersonal: true, own: false },
    });

    const search = await client.call<WorkforcePageDto>(
      'GET',
      `/workforce?search=${encodeURIComponent('احمد')}`,
    );
    expect(search.body.data.items.map((item) => item.id)).toEqual([ahmed.id]);

    const dry = await client.call<WorkforceDuplicatesDto>('POST', '/workforce?dryRun=true', {
      body: {
        category: 'contractor',
        fullName: 'ahmed ali',
        nationality: 'EG',
        employer: 'Other',
        jobPositionId: await welderId(client),
      },
    });
    expect(dry.status).toBe(200);
    expect(dry.body.data.duplicates.map((item) => item.id)).toEqual([ahmed.id]);
    await addPerson(client); // "Create anyway"

    const clash = await client.call('POST', '/workforce', {
      body: {
        category: 'employee',
        fullName: 'Omar Khan',
        employeeId: 'EMP-001',
        nationality: 'PK',
        employer: 'Main Co.',
        jobPositionId: await welderId(client),
      },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({
      code: 'WORKFORCE_EMPLOYEE_ID_TAKEN',
      params: { name: 'Ahmed Ali' },
    });

    const summary = await client.call<WorkforceSummaryDto>('GET', '/workforce/summary');
    expect(summary.body.data).toEqual({ total: 2, active: 2, needsAttention: 2 });

    const edited = await client.call<WorkforceMemberDto>('PATCH', `/workforce/${ahmed.id}`, {
      body: { department: 'Structures', mobile: '0551234567' },
    });
    expect(edited.body.data).toMatchObject({ department: 'Structures', mobile: '+966551234567' });
  });

  it('limits the directory to its permissions', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'hse_manager');
    const ahmed = await addPerson(client);
    const { client: supervisor } = await signedIn(target, 'supervisor');
    const view = await supervisor.call<WorkforceMemberDto>('GET', `/workforce/${ahmed.id}`);
    expect(view.status).toBe(200);
    expect(view.body.data.can).toMatchObject({
      edit: false,
      viewContacts: true,
      viewPersonal: false,
    });
    expect(
      (await supervisor.call('PATCH', `/workforce/${ahmed.id}`, { body: { department: 'X' } }))
        .status,
    ).toBe(403);
    const { client: foreman } = await signedIn(target, 'foreman');
    expect((await foreman.call('GET', '/workforce')).status).toBe(403);
    expect((await foreman.call('GET', `/workforce/${ahmed.id}`)).status).toBe(404);

    const other = await company();
    const { client: stranger } = await signedIn(other, 'hse_manager');
    expect((await stranger.call('GET', `/workforce/${ahmed.id}`)).status).toBe(404);
  });

  it('changes status, ends assignments, archives, restores and links a user', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    const ahmed = await addPerson(admin);
    expect(
      (
        await admin.call('POST', `/projects/${project.id}/workforce`, {
          body: { memberIds: [ahmed.id], positionId: 'own', startDate: today() },
        })
      ).status,
    ).toBe(201);

    // Only Inactive or Terminated people without open assignments can be archived.
    const early = await admin.call('POST', `/workforce/${ahmed.id}/archive`);
    expect(early.body.error).toMatchObject({
      code: 'WORKFORCE_ARCHIVE_REFUSED',
      params: { reason: 'status' },
    });

    const worker = await signedIn(target, 'worker');
    const linked = await admin.call<WorkforceMemberDto>('PUT', `/workforce/${ahmed.id}/user-link`, {
      body: { userId: worker.account.id },
    });
    expect(linked.body.data.linkedUser?.id).toBe(worker.account.id);
    const mine = await worker.client.call<MyWorkforceDto>('GET', '/me/workforce');
    expect(mine.status).toBe(200);
    expect(mine.body.data.member).toMatchObject({ id: ahmed.id, can: { own: true, edit: false } });
    // The linked user reads their own documents, but nobody else's profile.
    expect((await worker.client.call('GET', `/workforce/${ahmed.id}/documents`)).status).toBe(200);
    const someoneElse = await addPerson(admin, { fullName: 'Omar Khan' });
    expect((await worker.client.call('GET', `/workforce/${someoneElse.id}`)).status).toBe(404);

    const second = await admin.call('PUT', `/workforce/${someoneElse.id}/user-link`, {
      body: { userId: worker.account.id },
    });
    expect(second.body.error.code).toBe('WORKFORCE_USER_ALREADY_LINKED');

    const terminated = await admin.call<WorkforceMemberDto>(
      'POST',
      `/workforce/${ahmed.id}/status`,
      {
        body: {
          status: 'terminated',
          since: today(),
          reason: 'Contract ended',
          endAssignments: true,
        },
      },
    );
    expect(terminated.status).toBe(200);
    // Ended today: still on site today, closed from tomorrow.
    expect(terminated.body.data.currentAssignments.map((row) => row.endDate)).toEqual([today()]);

    const archived = await admin.call<WorkforceMemberDto>('POST', `/workforce/${ahmed.id}/archive`);
    expect(archived.body.data).toMatchObject({ archived: true, linkedUser: null });
    expect((await worker.client.call('GET', '/me/workforce')).status).toBe(404);
    const locked = await admin.call('PATCH', `/workforce/${ahmed.id}`, {
      body: { department: 'X' },
    });
    expect(locked.body.error.code).toBe('WORKFORCE_ARCHIVED');
    const list = await admin.call<WorkforcePageDto>('GET', '/workforce');
    expect(list.body.data.items.map((item) => item.id)).not.toContain(ahmed.id);
    const restored = await admin.call<WorkforceMemberDto>('POST', `/workforce/${ahmed.id}/restore`);
    expect(restored.body.data).toMatchObject({ archived: false, status: 'inactive' });

    const history = await admin.call<TimelinePageDto>('GET', `/workforce/${ahmed.id}/history`);
    expect(history.body.data.items.map((item) => item.action)).toEqual(
      expect.arrayContaining([
        'workforce.member.created',
        'workforce.assigned',
        'workforce.member.user_linked',
        'workforce.assignment_ended',
        'workforce.member.status_changed',
        'workforce.member.archived',
        'workforce.member.restored',
      ]),
    );
  });

  it('stores the photo and serves it to people who may see the person', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'hse_manager');
    const ahmed = await addPerson(client);
    const form = new FormData();
    form.set('file', new File([PNG], 'ahmed.png'));
    const saved = await client.raw('PUT', `/workforce/${ahmed.id}/photo`, { body: form });
    expect(saved.status).toBe(200);
    const profile = await client.call<WorkforceMemberDto>('GET', `/workforce/${ahmed.id}`);
    expect(profile.body.data.photoUrl).toMatch(/\/workforce\/.+\/photo\?v=/);
    expect((await client.raw('GET', `/workforce/${ahmed.id}/photo`)).status).toBe(200);
    const { client: client2 } = await signedIn(target, 'client');
    expect((await client2.raw('GET', `/workforce/${ahmed.id}/photo`)).status).toBe(404);
  });
});

describe('US-025 project assignments', () => {
  it('assigns in bulk, refuses suspended people and overlaps, ends and cancels', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    const pm = await signedIn(target, 'project_manager');
    await giveProjectRole(pm.account.id, target, project.id, 'project_manager');
    const [a, b, c] = [
      await addPerson(admin, { fullName: 'Ahmed Ali' }),
      await addPerson(admin, { fullName: 'Bilal Saeed' }),
      await addPerson(admin, { fullName: 'Chandra Rao', nationality: 'IN' }),
    ];
    const suspended = await addPerson(admin, { fullName: 'Mohammed Saleh' });
    await admin.call('POST', `/workforce/${suspended.id}/status`, {
      body: { status: 'suspended', since: today() },
    });

    const candidates = await pm.client.call<WorkforceCandidatesDto>(
      'GET',
      `/projects/${project.id}/workforce/candidates`,
    );
    expect(candidates.body.data.items.map((item) => item.fullName)).not.toContain('Mohammed Saleh');

    const refused = await pm.client.call('POST', `/projects/${project.id}/workforce`, {
      body: { memberIds: [a.id, suspended.id], positionId: 'own', startDate: today() },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({
      code: 'BULK_ASSIGN_REFUSED',
      details: [{ path: suspended.id, message: 'suspended' }],
    });

    const assigned = await pm.client.call<{ created: number }>(
      'POST',
      `/projects/${project.id}/workforce`,
      {
        body: {
          memberIds: [a.id, b.id, c.id],
          positionId: 'own',
          startDate: addIsoDays(today(), -10),
        },
      },
    );
    expect(assigned.body.data.created).toBe(3);
    const overlap = await pm.client.call('POST', `/projects/${project.id}/workforce`, {
      body: { memberIds: [a.id], positionId: 'own', startDate: addIsoDays(today(), 10) },
    });
    expect(overlap.body.error.code).toBe('WORKFORCE_ASSIGNMENT_OVERLAP');

    // The same person may work on another project at the same time.
    const other = await createProject(admin);
    expect(
      (
        await admin.call('POST', `/projects/${other.id}/workforce`, {
          body: { memberIds: [a.id], positionId: 'own', startDate: today() },
        })
      ).status,
    ).toBe(201);

    const list = await pm.client.call<ProjectWorkforcePageDto>(
      'GET',
      `/projects/${project.id}/workforce`,
    );
    expect(list.body.data).toMatchObject({ total: 3, canAssign: true, canOpenProfiles: true });
    const row = list.body.data.items.find((item) => item.member.id === b.id);
    expect(row?.state).toBe('current');
    expect(
      (
        await pm.client.call(
          'POST',
          `/projects/${project.id}/workforce/${row?.assignmentId ?? ''}/end`,
          { body: { endDate: addIsoDays(today(), -1) } },
        )
      ).status,
    ).toBe(204);
    const ended = await pm.client.call<ProjectWorkforcePageDto>(
      'GET',
      `/projects/${project.id}/workforce?state=ended`,
    );
    expect(ended.body.data.items.map((item) => item.member.id)).toEqual([b.id]);

    // An upcoming assignment can be cancelled; a current one can't.
    await pm.client.call('POST', `/projects/${project.id}/workforce`, {
      body: { memberIds: [b.id], positionId: 'own', startDate: addIsoDays(today(), 5) },
    });
    const upcoming = await pm.client.call<ProjectWorkforcePageDto>(
      'GET',
      `/projects/${project.id}/workforce?state=upcoming`,
    );
    const next = upcoming.body.data.items[0];
    expect(next?.state).toBe('upcoming');
    expect(
      (
        await pm.client.call(
          'POST',
          `/projects/${project.id}/workforce/${next?.assignmentId ?? ''}/cancel`,
        )
      ).status,
    ).toBe(204);
    const current = list.body.data.items.find((item) => item.member.id === c.id);
    expect(
      (
        await pm.client.call(
          'POST',
          `/projects/${project.id}/workforce/${current?.assignmentId ?? ''}/cancel`,
        )
      ).status,
    ).toBe(422);

    const timeline = await pm.client.call<TimelinePageDto>(
      'GET',
      `/projects/${project.id}/timeline?type=workforce`,
    );
    expect(timeline.body.data.items.map((item) => item.action)).toEqual(
      expect.arrayContaining([
        'workforce.assigned',
        'workforce.assignment_ended',
        'workforce.assignment_cancelled',
      ]),
    );
  });

  it('refuses completed projects and shows the tab by project role', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    const person = await addPerson(admin);
    await admin.call('POST', `/projects/${project.id}/workforce`, {
      body: { memberIds: [person.id], positionId: 'own', startDate: today() },
    });

    const foreman = await signedIn(target, 'foreman');
    await giveProjectRole(foreman.account.id, target, project.id, 'foreman');
    const seen = await foreman.client.call<ProjectWorkforcePageDto>(
      'GET',
      `/projects/${project.id}/workforce`,
    );
    expect(seen.body.data).toMatchObject({ total: 1, canAssign: false, canOpenProfiles: false });
    const visitor = await signedIn(target, 'client');
    await giveProjectRole(visitor.account.id, target, project.id, 'client', {
      until: Date.now() + 30 * 86_400_000,
    });
    expect((await visitor.client.call('GET', `/projects/${project.id}/workforce`)).status).toBe(
      403,
    );

    const done = await admin.call('POST', `/projects/${project.id}/status`, {
      body: { status: 'completed', version: project.version },
    });
    expect(done.status, JSON.stringify(done.body.error)).toBe(200);
    const closed = await admin.call('POST', `/projects/${project.id}/workforce`, {
      body: { memberIds: [person.id], positionId: 'own', startDate: addIsoDays(today(), 60) },
    });
    expect(closed.body.error.code).toBe('PROJECT_CLOSED_FOR_ASSIGNMENT');
  });
});

describe('US-026 – US-030 records', () => {
  it('training expiry, refresher replacement and void keep history', async () => {
    const target = await company();
    const { manager, officer } = await team(target);
    const ahmed = await addPerson(manager.client);
    const created = await addRecord(
      officer.client,
      ahmed.id,
      'trainings',
      {
        name: 'Working at Height',
        issuedOn: today(),
        expiresOn: addIsoDays(today(), 20),
      },
      { bytes: PDF, name: 'wah.pdf' },
    );
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      expiryState: 'expiring',
      hasFile: true,
      state: 'current',
    });

    const future = await addRecord(officer.client, ahmed.id, 'trainings', {
      name: 'First Aid',
      issuedOn: addIsoDays(today(), 2),
    });
    expect(future.status).toBe(422);

    const renewed = await officer.client.raw(
      'POST',
      `/workforce/${ahmed.id}/trainings/${created.body.data.id}/renew`,
      {
        body: recordForm({
          name: 'Working at Height',
          issuedOn: today(),
          expiresOn: addIsoDays(today(), 365),
        }),
      },
    );
    expect(renewed.status).toBe(201);
    const current = await officer.client.call<WorkforceRecordListDto>(
      'GET',
      `/workforce/${ahmed.id}/trainings`,
    );
    expect(current.body.data.items).toHaveLength(1);
    const history = await officer.client.call<WorkforceRecordListDto>(
      'GET',
      `/workforce/${ahmed.id}/trainings?include=history`,
    );
    expect(history.body.data.items.map((item) => item.state).sort()).toEqual([
      'current',
      'replaced',
    ]);
    const replaced = history.body.data.items.find((item) => item.state === 'replaced');
    expect(
      (
        await officer.client.call(
          'POST',
          `/workforce/${ahmed.id}/trainings/${replaced?.id ?? ''}/void`,
          { body: { reason: 'Entered twice' } },
        )
      ).body.error.code,
    ).toBe('WORKFORCE_RECORD_VOIDED');

    const file = await officer.client.raw(
      'GET',
      `/workforce/${ahmed.id}/trainings/${created.body.data.id}/file`,
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');

    // No route deletes a record.
    const deleted = await officer.client.call(
      'DELETE',
      `/workforce/${ahmed.id}/trainings/${created.body.data.id}`,
    );
    expect(deleted.status).toBe(404);
  });

  it('certificates need an expiry or No expiry; expired ones mark the person', async () => {
    const target = await company();
    const { manager } = await team(target);
    const ahmed = await addPerson(manager.client);
    const missing = await addRecord(manager.client, ahmed.id, 'certificates', {
      type: 'operator_licence',
      issuedOn: addIsoDays(today(), -400),
    });
    expect(missing.status).toBe(422);
    const expired = await addRecord(manager.client, ahmed.id, 'certificates', {
      type: 'operator_licence',
      number: 'OP-778',
      issuedOn: addIsoDays(today(), -400),
      expiresOn: addIsoDays(today(), -1),
    });
    expect(expired.body.data.expiryState).toBe('expired');
    const profile = await manager.client.call<WorkforceMemberDto>('GET', `/workforce/${ahmed.id}`);
    expect(profile.body.data.compliance).toMatchObject({ badge: 'expired', expired: 1 });
    const attention = await manager.client.call<WorkforcePageDto>(
      'GET',
      '/workforce?attention=true',
    );
    expect(attention.body.data.items.map((item) => item.id)).toEqual([ahmed.id]);
  });

  it('medical details and documents stay with workforce.personal.view', async () => {
    const target = await company();
    const { manager, officer } = await team(target);
    const ahmed = await addPerson(manager.client);
    const medical = await addRecord(
      manager.client,
      ahmed.id,
      'medical',
      {
        type: 'fit_with_restrictions',
        issuedOn: today(),
        expiresOn: addIsoDays(today(), 200),
        restrictionNote: 'No work at height',
        issuer: 'City Clinic',
      },
      { bytes: PDF, name: 'medical.pdf' },
    );
    expect(medical.status).toBe(201);
    const seen = await officer.client.call<WorkforceRecordListDto>(
      'GET',
      `/workforce/${ahmed.id}/medical`,
    );
    expect(seen.body.data.status).toMatchObject({
      fitness: 'fit_with_restrictions',
      hasRestrictions: true,
    });
    expect(seen.body.data.items[0]).toMatchObject({
      restrictionNote: null,
      issuer: null,
      hasFile: false,
    });
    expect(
      (
        await officer.client.raw(
          'GET',
          `/workforce/${ahmed.id}/medical/${medical.body.data.id}/file`,
        )
      ).status,
    ).toBe(404);
    // A Safety Officer manages workforce but not personal data.
    const refused = await addRecord(officer.client, ahmed.id, 'medical', {
      type: 'unfit',
      issuedOn: today(),
    });
    expect(refused.status).toBe(403);

    const iqama = await addRecord(
      manager.client,
      ahmed.id,
      'documents',
      { type: 'residence_permit', number: '2412344821', expiresOn: addIsoDays(today(), 300) },
      { bytes: PDF, name: 'iqama.pdf' },
    );
    expect(iqama.status).toBe(201);
    const noCopy = await addRecord(manager.client, ahmed.id, 'documents', {
      type: 'employment_contract',
    });
    expect(noCopy.status).toBe(422);
    const listed = await manager.client.call<WorkforceRecordListDto>(
      'GET',
      `/workforce/${ahmed.id}/documents`,
    );
    expect(listed.body.data.items[0]?.number).toBe('•••• 4821');
    const detail = await manager.client.call<WorkforceRecordDto>(
      'GET',
      `/workforce/${ahmed.id}/documents/${iqama.body.data.id}`,
    );
    expect(detail.body.data.number).toBe('2412344821');
    expect((await officer.client.call('GET', `/workforce/${ahmed.id}/documents`)).status).toBe(403);
    expect(
      (
        await officer.client.raw(
          'GET',
          `/workforce/${ahmed.id}/documents/${iqama.body.data.id}/file`,
        )
      ).status,
    ).toBe(404);

    // The generic file route never serves workforce files (T-49).
    const row = await harness.env.DB.prepare(
      'SELECT file_id AS fileId FROM workforce_record WHERE id = ?',
    )
      .bind(iqama.body.data.id)
      .first<{ fileId: string }>();
    expect((await manager.client.raw('GET', `/files/${row?.fileId ?? ''}`)).status).toBe(404);

    const opened = await harness.env.DB.prepare(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'workforce.document.opened' AND entity_id = ?",
    )
      .bind(iqama.body.data.id)
      .first<{ n: number }>();
    expect(opened?.n).toBe(1);

    // Same number for another person is refused.
    const omar = await addPerson(manager.client, { fullName: 'Omar Khan' });
    const clash = await addRecord(
      manager.client,
      omar.id,
      'documents',
      { type: 'residence_permit', number: '2412344821', expiresOn: addIsoDays(today(), 300) },
      { bytes: PDF, name: 'iqama.pdf' },
    );
    expect(clash.body.error?.code).toBe('WORKFORCE_DOCUMENT_NUMBER_TAKEN');

    // History hides personal records from readers without the permission.
    const history = await officer.client.call<TimelinePageDto>(
      'GET',
      `/workforce/${ahmed.id}/history`,
    );
    expect(history.body.data.items.some((item) => item.snapshot.recordKind === 'document')).toBe(
      false,
    );
  });

  it('emergency contacts: up to 3, by permission', async () => {
    const target = await company();
    const { manager } = await team(target);
    const ahmed = await addPerson(manager.client);
    const contact = { name: 'Fatima Ali', relationship: 'spouse', phone: '0551112222' };
    const saved = await manager.client.call<{ items: unknown[] }>(
      'PUT',
      `/workforce/${ahmed.id}/emergency-contacts`,
      { body: { items: [contact, { ...contact, name: 'Ali Hassan', relationship: 'parent' }] } },
    );
    expect(saved.body.data.items).toHaveLength(2);
    const four = await manager.client.call('PUT', `/workforce/${ahmed.id}/emergency-contacts`, {
      body: { items: [contact, contact, contact, contact] },
    });
    expect(four.body.error.code).toBe('WORKFORCE_CONTACT_LIMIT');
    const { client: supervisor } = await signedIn(target, 'supervisor');
    expect((await supervisor.call('GET', `/workforce/${ahmed.id}/emergency-contacts`)).status).toBe(
      200,
    );
    const { client: engineer } = await signedIn(target, 'site_engineer');
    expect((await engineer.call('GET', `/workforce/${ahmed.id}/emergency-contacts`)).status).toBe(
      403,
    );
    const profile = await engineer.call<WorkforceMemberDto>('GET', `/workforce/${ahmed.id}`);
    expect(profile.body.data.compliance.noEmergencyContact).toBeUndefined();
  });
});

describe('PLT-20 expiry reminders', () => {
  it('sends each threshold once, one digest per recipient, personal items only to their readers', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const { manager, officer } = await team(target);
    const project = await createProject(admin);
    const pm = await signedIn(target, 'project_manager');
    await giveProjectRole(pm.account.id, target, project.id, 'project_manager');
    const ahmed = await addPerson(manager.client);
    await admin.call('POST', `/projects/${project.id}/workforce`, {
      body: { memberIds: [ahmed.id], positionId: 'own', startDate: today() },
    });
    const worker = await signedIn(target, 'worker');
    await admin.call('PUT', `/workforce/${ahmed.id}/user-link`, {
      body: { userId: worker.account.id },
    });
    await addRecord(manager.client, ahmed.id, 'certificates', {
      type: 'operator_licence',
      issuedOn: addIsoDays(today(), -300),
      expiresOn: addIsoDays(today(), 7),
    });
    await addRecord(
      manager.client,
      ahmed.id,
      'documents',
      { type: 'work_permit', expiresOn: addIsoDays(today(), 30) },
      { bytes: PDF, name: 'permit.pdf' },
    );

    await workforceExpiryJob.run(jobContext());
    await workforceExpiryJob.run(jobContext());

    const digests = async (client: TestClient) =>
      (await client.call<NotificationPageDto>('GET', '/notifications')).body.data.items.filter(
        (item) => item.type === 'workforce.attention.digest',
      );
    const managerDigests = await digests(manager.client);
    expect(managerDigests).toHaveLength(1);
    expect(managerDigests[0]?.params).toMatchObject({ count: 2, expiring: 2 });
    const officerDigests = await digests(officer.client);
    expect(officerDigests[0]?.params).toMatchObject({ count: 1 });
    const pmDigests = await digests(pm.client);
    expect(pmDigests[0]).toMatchObject({ projectId: project.id, params: { count: 1 } });

    const own = (
      await worker.client.call<NotificationPageDto>('GET', '/notifications')
    ).body.data.items.filter((item) => item.type === 'workforce.record.expiring');
    expect(own).toHaveLength(2);

    const opened = await pm.client.call<{ route: string }>(
      'GET',
      `/notifications/${pmDigests[0]?.id ?? ''}/open`,
    );
    expect(opened.body.data.route).toBe(`/projects/${project.id}/workforce?attention=true`);
  });
});

describe('Sprint 7 read-only mode and the directory contract', () => {
  it('blocks workforce writes in read-only mode but keeps reads', async () => {
    const target = await company();
    const { client } = await signedIn(target, 'hse_manager');
    const ahmed = await addPerson(client);
    await makeReadOnly(target);
    const refused = await client.call('PATCH', `/workforce/${ahmed.id}`, {
      body: { department: 'X' },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    expect((await client.call('GET', `/workforce/${ahmed.id}`)).status).toBe(200);
  });

  it('tells later modules whether a person is available for work (T-47)', async () => {
    const target = await company();
    const { client: admin } = await signedIn(target, 'company_administrator');
    const project = await createProject(admin);
    const ahmed = await addPerson(admin);
    const directory = new WorkforceDirectory(createDatabase(harness.env.DB));
    const before = await directory.availability(target.id, ahmed.id, project.id, today());
    expect(before?.operational).toBe(false);
    await admin.call('POST', `/projects/${project.id}/workforce`, {
      body: { memberIds: [ahmed.id], positionId: 'own', startDate: today() },
    });
    await addRecord(admin, ahmed.id, 'medical', {
      type: 'fit',
      issuedOn: today(),
      expiresOn: addIsoDays(today(), 365),
    });
    const after = await directory.availability(target.id, ahmed.id, project.id, today());
    expect(after).toMatchObject({ operational: true, medical: { fitness: 'fit' } });
  });
});
