import {
  type ActionDto,
  addIsoDays,
  type InspectionCategoryDto,
  type InspectionDto,
  type InspectionFileDto,
  type InspectionItemDto,
  type InspectionPageDto,
  type MyInspectionsPageDto,
  type NotificationPageDto,
  type ReadinessDto,
  type TemplateContentInput,
  type TemplateDetailDto,
  type TemplatePackDto,
  type TemplateSummaryDto,
  type TimelinePageDto,
  zonedIsoDate,
} from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config';
import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { inspectionDueJob } from '../../src/modules/inspection';
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
const DAY_MS = 24 * 60 * 60 * 1000;
const today = () => zonedIsoDate(Date.now(), 'Asia/Riyadh');

interface Person {
  id: string;
  client: TestClient;
}

interface Team {
  target: SeededCompany;
  projectId: string;
  projectCode: string;
  admin: TestClient;
  manager: Person;
  officer: Person;
  inspector: Person;
  engineer: Person;
  worker: Person;
}

async function team(): Promise<Team> {
  const target = await company();
  const { client: admin } = await signedIn(target, 'company_administrator');
  const project = await createProject(admin);
  const member = async (role: 'safety_officer' | 'inspector' | 'site_engineer' | 'worker') => {
    const { account, client } = await signedIn(target, role);
    await giveProjectRole(account.id, target, project.id, role);
    return { id: account.id, client };
  };
  const { account: hm, client: manager } = await signedIn(target, 'hse_manager');
  return {
    target,
    projectId: project.id,
    projectCode: project.code,
    admin,
    manager: { id: hm.id, client: manager },
    officer: await member('safety_officer'),
    inspector: await member('inspector'),
    engineer: await member('site_engineer'),
    worker: await member('worker'),
  };
}

const keys = {
  s1: crypto.randomUUID(),
  s2: crypto.randomUUID(),
  a: crypto.randomUUID(),
  b: crypto.randomUUID(),
  c: crypto.randomUUID(),
  d: crypto.randomUUID(),
  e: crypto.randomUUID(),
};

function content(overrides: Partial<TemplateContentInput> = {}): TemplateContentInput {
  return {
    results: ['pass', 'fail', 'observation', 'not_applicable'],
    scoring: { method: 'percentage', passMark: 80 },
    needsApproval: true,
    areaRequired: false,
    sections: [
      {
        key: keys.s1,
        title: { en: 'Scaffold' },
        items: [
          { key: keys.a, question: { en: 'Base plates in place' }, weight: 2 },
          { key: keys.b, question: { en: 'Guardrails fitted' }, critical: true },
          { key: keys.c, question: { en: 'Tag up to date' }, photoOnFail: false },
        ],
      },
      {
        key: keys.s2,
        title: { en: 'Access' },
        items: [
          { key: keys.d, question: { en: 'Ladder tied' } },
          { key: keys.e, question: { en: 'Clear access route' } },
        ],
      },
    ],
    ...overrides,
  };
}

async function categories(client: TestClient): Promise<InspectionCategoryDto[]> {
  const result = await client.call<InspectionCategoryDto[]>('GET', '/inspection-categories');
  expect(result.status, JSON.stringify(result.body.error)).toBe(200);
  return result.body.data;
}

/** Creates and publishes a template with `content()`; returns it. */
async function publishedTemplate(
  t: Team,
  overrides: Partial<TemplateContentInput> = {},
  name = `Scaffold ${crypto.randomUUID().slice(0, 6)}`,
): Promise<TemplateDetailDto> {
  const [category] = await categories(t.admin);
  const created = await t.admin.call<TemplateDetailDto>('POST', '/inspection-templates', {
    body: { nameEn: name, categoryId: category?.id },
  });
  expect(created.status, JSON.stringify(created.body.error)).toBe(201);
  const draft = created.body.data.draft;
  const saved = await t.admin.call<TemplateDetailDto>('PUT', `/inspection-templates/${created.body.data.id}/draft`, {
    body: { content: content(overrides), expectedUpdatedAt: draft?.updatedAt },
  });
  expect(saved.status, JSON.stringify(saved.body.error)).toBe(200);
  const published = await t.admin.call<TemplateDetailDto>(
    'POST',
    `/inspection-templates/${created.body.data.id}/publish`,
  );
  expect(published.status, JSON.stringify(published.body.error)).toBe(200);
  return published.body.data;
}

function base(t: Team) {
  return `/projects/${t.projectId}/inspections`;
}

async function plan(t: Team, template: TemplateDetailDto, inspectorId = t.inspector.id): Promise<InspectionDto> {
  const result = await t.officer.client.call<InspectionDto>('POST', base(t), {
    body: { mode: 'plan', templateId: template.id, inspectorId, plannedOn: today() },
  });
  expect(result.status, JSON.stringify(result.body.error)).toBe(201);
  return result.body.data;
}

async function start(t: Team, template: TemplateDetailDto, who: Person = t.inspector): Promise<InspectionDto> {
  const result = await who.client.call<InspectionDto>('POST', base(t), {
    body: { mode: 'start', templateVersionId: template.currentVersionId },
  });
  expect(result.status, JSON.stringify(result.body.error)).toBe(201);
  return result.body.data;
}

async function answer(
  who: Person,
  t: Team,
  id: string,
  itemKey: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  if (headers) {
    const response = await who.client.raw('PUT', `${base(t)}/${id}/items/${itemKey}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    });
    return {
      status: response.status,
      replayed: response.headers.get('Idempotent-Replayed') === 'true',
      body: await response.json<{ data: InspectionItemDto; error?: { code: string } }>(),
    };
  }
  const result = await who.client.call<InspectionItemDto>('PUT', `${base(t)}/${id}/items/${itemKey}`, { body });
  return { status: result.status, replayed: false, body: result.body };
}

async function photo(who: Person, t: Team, id: string, itemKey: string | null, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append('file', new File([PNG], 'photo.png', { type: 'image/png' }));
  if (itemKey) form.append('itemKey', itemKey);
  const response = await who.client.raw('POST', `${base(t)}/${id}/files`, { body: form, headers });
  return {
    status: response.status,
    replayed: response.headers.get('Idempotent-Replayed') === 'true',
    body: await response.json<{ data: InspectionFileDto; error?: { code: string } }>(),
  };
}

async function move(who: Person | { client: TestClient }, t: Team, id: string, body: Record<string, unknown>) {
  return who.client.call<InspectionDto>('POST', `${base(t)}/${id}/transitions`, { body });
}

async function get(who: Person | { client: TestClient }, t: Team, id: string) {
  return who.client.call<InspectionDto>('GET', `${base(t)}/${id}`);
}

/** Answers every item: `b` fails (with comment and photo), the rest pass. */
async function captureWithFail(t: Team, id: string, assignedTo: string | null = null) {
  for (const key of [keys.a, keys.c, keys.d, keys.e]) {
    expect((await answer(t.inspector, t, id, key, { result: 'pass' })).status).toBe(200);
  }
  expect(
    (
      await answer(t.inspector, t, id, keys.b, {
        result: 'fail',
        comment: 'Guardrail missing on level 3',
        priority: 'medium',
        assignedTo,
      })
    ).status,
  ).toBe(200);
  expect((await photo(t.inspector, t, id, keys.b)).status).toBe(201);
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

// ---- Templates (US-031, US-032) --------------------------------------------------------------

describe('US-031 inspection templates', () => {
  it('seeds the twelve categories and the published starter template once', async () => {
    const t = await team();
    const cats = await categories(t.admin);
    expect(cats).toHaveLength(12);
    await categories(t.manager.client);
    expect(await count('SELECT count(*) AS n FROM inspection_category WHERE company_id = ?', t.target.id)).toBe(12);
    const list = await t.officer.client.call<{ items: TemplateSummaryDto[] }>('GET', '/inspection-templates');
    expect(list.status).toBe(200);
    const starter = list.body.data.items.find((item) => item.nameEn === 'Daily Site Safety Inspection');
    expect(starter?.currentVersionNo).toBe(1);
    expect(starter?.itemCount).toBe(28);
  });

  it('creates, saves and publishes a template; refuses an empty one and non-managers', async () => {
    const t = await team();
    const [category] = await categories(t.admin);
    const created = await t.admin.call<TemplateDetailDto>('POST', '/inspection-templates', {
      body: { nameEn: 'Excavation check', categoryId: category?.id },
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const empty = await t.admin.call('POST', `/inspection-templates/${id}/publish`);
    expect(empty.status).toBe(422);
    expect(empty.body.error?.code).toBe('TEMPLATE_INVALID');

    const stale = await t.admin.call('PUT', `/inspection-templates/${id}/draft`, {
      body: { content: content(), expectedUpdatedAt: 1 },
    });
    expect(stale.body.error?.code).toBe('TEMPLATE_DRAFT_CHANGED');

    const dupe = await t.admin.call('POST', '/inspection-templates', {
      body: { nameEn: 'EXCAVATION CHECK', categoryId: category?.id },
    });
    expect(dupe.body.error?.code).toBe('TEMPLATE_NAME_TAKEN');

    const officer = await t.officer.client.call('POST', '/inspection-templates', {
      body: { nameEn: 'Officer template', categoryId: category?.id },
    });
    expect(officer.status).toBe(403);

    const template = await publishedTemplate(t);
    expect(template.current?.versionNo).toBe(1);
    expect(template.current?.content.results).toEqual(['pass', 'fail', 'observation', 'not_applicable']);
  });

  it('a new version leaves inspections on the old one; published versions never change', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const inspection = await start(t, template);

    const draft = await t.admin.call<TemplateDetailDto>('POST', `/inspection-templates/${template.id}/draft`);
    expect(draft.status).toBe(201);
    expect((await t.admin.call('POST', `/inspection-templates/${template.id}/draft`)).body.error?.code).toBe(
      'TEMPLATE_DRAFT_EXISTS',
    );
    const changed = content();
    changed.sections[0]?.items.push({ key: crypto.randomUUID(), question: { en: 'Toe boards fitted' } });
    await t.admin.call('PUT', `/inspection-templates/${template.id}/draft`, {
      body: { content: changed, expectedUpdatedAt: draft.body.data.draft?.updatedAt },
    });
    const v2 = await t.admin.call<TemplateDetailDto>('POST', `/inspection-templates/${template.id}/publish`);
    expect(v2.body.data.current?.versionNo).toBe(2);

    const still = await get(t.inspector, t, inspection.id);
    expect(still.body.data.versionNo).toBe(1);
    expect(still.body.data.content.sections[0]?.items).toHaveLength(3);

    const versions = await t.admin.call<{ versionNo: number; state: string; inspectionCount: number }[]>(
      'GET',
      `/inspection-templates/${template.id}/versions`,
    );
    expect(versions.body.data.map((v) => [v.versionNo, v.state, v.inspectionCount])).toEqual([
      [2, 'published', 0],
      [1, 'superseded', 1],
    ]);

    // Doc 10 §18: the trigger refuses any change to a published version.
    await expect(
      harness.env.DB.prepare(
        "UPDATE inspection_template_version SET content = '{}' WHERE template_id = ? AND version_no = 1",
      )
        .bind(template.id)
        .run(),
    ).rejects.toThrow(/never change/);

    // Retire: no new inspections online.
    await t.admin.call('POST', `/inspection-templates/${template.id}/retire`);
    const refused = await t.inspector.client.call('POST', base(t), {
      body: { mode: 'start', templateVersionId: v2.body.data.currentVersionId },
    });
    expect(refused.body.error?.code).toBe('TEMPLATE_RETIRED');
  });

  it('serves the device pack with an ETag', async () => {
    const t = await team();
    await publishedTemplate(t);
    const first = await t.inspector.client.raw('GET', '/inspection-templates/offline-pack');
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag') ?? '';
    const pack = (await first.json<{ data: TemplatePackDto }>()).data;
    expect(pack.versions.length).toBeGreaterThanOrEqual(2);
    const again = await t.inspector.client.raw('GET', '/inspection-templates/offline-pack', {
      headers: { 'if-none-match': etag },
    });
    expect(again.status).toBe(304);
    expect((await t.worker.client.raw('GET', '/inspection-templates/offline-pack')).status).toBe(403);
  });
});

// ---- The workflow (PLT-32, US-033 – US-039) --------------------------------------------------

describe('PLT-32 inspection workflow', () => {
  it('plan → start → capture → submit → return → resubmit → approve → action closed → inspection closed', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const planned = await plan(t, template);
    expect(planned.status).toBe('draft');
    expect(planned.reference).toBe(`${t.projectCode}-INS-0001`);

    const notes = await t.inspector.client.call<NotificationPageDto>('GET', '/notifications');
    expect(notes.body.data.items.some((n) => n.type === 'inspection.assigned')).toBe(true);
    const mine = await t.inspector.client.call<MyInspectionsPageDto>('GET', '/me/inspections?tab=assigned');
    expect(mine.body.data.items.map((i) => i.id)).toContain(planned.id);

    // Only the inspector starts it.
    expect((await move(t.officer, t, planned.id, { to: 'start' })).body.error?.code).toBe('INSPECTION_NOT_INSPECTOR');
    const started = await move(t.inspector, t, planned.id, { to: 'start' });
    expect(started.body.data.status).toBe('in_progress');

    // Incomplete: refused with the items named.
    const early = await move(t.inspector, t, planned.id, { to: 'submit' });
    expect(early.status).toBe(422);
    expect(early.body.error?.code).toBe('INSPECTION_INCOMPLETE');

    // A result the template doesn't allow and an unknown key.
    expect((await answer(t.inspector, t, planned.id, keys.a, { result: 'not_inspected' })).status).toBe(422);
    expect((await answer(t.inspector, t, planned.id, crypto.randomUUID(), { result: 'pass' })).body.error?.code).toBe(
      'INSPECTION_ITEM_UNKNOWN',
    );

    // Fail without its photo: evidence required.
    for (const key of [keys.a, keys.c, keys.d, keys.e]) {
      await answer(t.inspector, t, planned.id, key, { result: 'pass' });
    }
    await answer(t.inspector, t, planned.id, keys.b, {
      result: 'fail',
      comment: 'Guardrail missing on level 3',
      assignedTo: t.engineer.id,
    });
    const noPhoto = await move(t.inspector, t, planned.id, { to: 'submit' });
    expect(noPhoto.body.error?.code).toBe('INSPECTION_EVIDENCE_REQUIRED');
    expect((await photo(t.inspector, t, planned.id, keys.b)).status).toBe(201);

    const ready = await t.inspector.client.call<ReadinessDto>('GET', `${base(t)}/${planned.id}/readiness`);
    expect(ready.body.data.issues).toEqual([]);
    expect(ready.body.data.findingCount).toBe(1);

    const submitted = await move(t.inspector, t, planned.id, { to: 'submit' });
    expect(submitted.status, JSON.stringify(submitted.body.error)).toBe(200);
    expect(submitted.body.data.status).toBe('submitted');
    // Weighted: a (2) + c + d + e pass = 5, b (1) fails → 5/6 = 83.3 %, but b is critical.
    expect(submitted.body.data.scorePercent).toBe(83.3);
    expect(submitted.body.data.scoreOutcome).toBe('pass');
    expect(submitted.body.data.findings).toHaveLength(1);
    const finding = submitted.body.data.findings[0];
    expect(finding?.responsible?.id).toBe(t.engineer.id);
    expect(finding?.severity).toBe('medium');

    // Locked after submit (Doc 10 §18).
    expect((await answer(t.inspector, t, planned.id, keys.a, { result: 'fail' })).body.error?.code).toBe(
      'INSPECTION_LOCKED',
    );
    const submittedPhoto = submitted.body.data.files[0];
    expect(submittedPhoto?.removable).toBe(false);

    // The inspector can't review; the HSE Manager opens it, so withdraw is refused.
    expect((await move(t.inspector, t, planned.id, { to: 'approve' })).body.error?.code).toBe(
      'INSPECTION_SELF_APPROVAL',
    );
    expect((await t.manager.client.call('POST', `${base(t)}/${planned.id}/review-start`)).status).toBe(204);
    expect((await get(t.manager, t, planned.id)).body.data.underReview).toBe(true);
    expect((await move(t.inspector, t, planned.id, { to: 'withdraw' })).body.error?.code).toBe(
      'INSPECTION_TRANSITION_NOT_ALLOWED',
    );

    // The reviewer edits the finding, then returns the inspection.
    const edited = await t.manager.client.call('PATCH', `${base(t)}/${planned.id}/findings/${finding?.id ?? ''}`, {
      body: { severity: 'high', dueOn: addIsoDays(today(), 2) },
    });
    expect(edited.status, JSON.stringify(edited.body.error)).toBe(200);
    expect((await move(t.manager, t, planned.id, { to: 'return', reason: 'Add the level 3 photo' })).body.data.status).toBe(
      'in_progress',
    );
    // Submitted photos stay even after the return.
    const removal = await t.inspector.client.call('DELETE', `${base(t)}/${planned.id}/files/${submittedPhoto?.id ?? ''}`);
    expect(removal.body.error?.code).toBe('INSPECTION_LOCKED');

    const again = await move(t.inspector, t, planned.id, { to: 'submit' });
    expect(again.body.data.findings[0]?.severity).toBe('high');
    expect(again.body.data.findings[0]?.edited).toBe(true);

    // Approve: one action raised in the same batch, linked to the finding.
    const approved = await move(t.manager, t, planned.id, { to: 'approve' });
    expect(approved.status, JSON.stringify(approved.body.error)).toBe(200);
    expect(approved.body.data.status).toBe('approved');
    const action = approved.body.data.findings[0]?.actions[0];
    expect(action?.reference).toBe(`${t.projectCode}-ACT-0001`);
    expect(approved.body.data.findings[0]?.status).toBe('action_raised');

    const actionPage = await t.engineer.client.call<ActionDto>('GET', `/projects/${t.projectId}/actions/${action?.id ?? ''}`);
    expect(actionPage.body.data.source.label).toBe(`${t.projectCode}-INS-0001 · Finding 1`);

    // The owner completes it with evidence (High), the officer verifies and closes → inspection closes.
    const evidence = new FormData();
    evidence.append('files', new File([PNG], 'fixed.png'));
    const uploaded = await t.engineer.client.raw('POST', `/projects/${t.projectId}/actions/${action?.id ?? ''}/files`, {
      body: evidence,
    });
    const fileIds = (await uploaded.json<{ data: { files: { id: string }[] } }>()).data.files.map((f) => f.id);
    const completed = await t.engineer.client.call('POST', `/projects/${t.projectId}/actions/${action?.id ?? ''}/transitions`, {
      body: { transition: 'complete', note: 'Guardrail fitted on level 3', evidenceFileIds: fileIds },
    });
    expect(completed.status, JSON.stringify(completed.body.error)).toBe(200);
    const closed = await t.officer.client.call('POST', `/projects/${t.projectId}/actions/${action?.id ?? ''}/transitions`, {
      body: { transition: 'verify_and_close', method: 'site_visit' },
    });
    expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);

    const final = await get(t.inspector, t, planned.id);
    expect(final.body.data.status).toBe('closed');
    expect(final.body.data.findings[0]?.status).toBe('resolved');

    const history = await t.inspector.client.call<TimelinePageDto>('GET', `${base(t)}/${planned.id}/history`);
    const actions = history.body.data.items.map((e) => e.action);
    for (const name of ['inspection.planned', 'inspection.started', 'inspection.submitted', 'inspection.returned', 'inspection.approved', 'inspection.finding_resolved', 'inspection.closed']) {
      expect(actions).toContain(name);
    }
  });

  it('approves and closes at once without findings; voiding an action reopens its finding', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const clean = await start(t, template);
    for (const key of [keys.a, keys.b, keys.c, keys.d, keys.e]) await answer(t.inspector, t, clean.id, key, { result: 'pass' });
    await move(t.inspector, t, clean.id, { to: 'submit' });
    const approved = await move(t.officer, t, clean.id, { to: 'approve' });
    expect(approved.body.data.status).toBe('closed');

    const failing = await start(t, template);
    await captureWithFail(t, failing.id);
    await move(t.inspector, t, failing.id, { to: 'submit' });
    // No responsible person: approval refused.
    expect((await move(t.officer, t, failing.id, { to: 'approve' })).body.error?.code).toBe('FINDING_OWNER_REQUIRED');
    const loaded = await get(t.officer, t, failing.id);
    const findingId = loaded.body.data.findings[0]?.id ?? '';
    await t.officer.client.call('PATCH', `${base(t)}/${failing.id}/findings/${findingId}`, {
      body: { responsibleId: t.engineer.id },
    });
    const ok = await move(t.officer, t, failing.id, { to: 'approve' });
    expect(ok.status, JSON.stringify(ok.body.error)).toBe(200);
    const actionId = ok.body.data.findings[0]?.actions[0]?.id ?? '';
    const voided = await t.officer.client.call('POST', `/projects/${t.projectId}/actions/${actionId}/void`, {
      body: { reason: 'Raised by mistake, duplicate' },
    });
    expect(voided.status, JSON.stringify(voided.body.error)).toBe(200);
    const reopened = await get(t.officer, t, failing.id);
    expect(reopened.body.data.findings[0]?.status).toBe('open');
    expect(reopened.body.data.status).toBe('approved');

    // No action needed closes the inspection.
    const none = await t.officer.client.call('POST', `${base(t)}/${failing.id}/findings/${findingId}/no-action`, {
      body: { reason: 'Fixed on the spot' },
    });
    expect(none.status, JSON.stringify(none.body.error)).toBe(200);
    expect((await get(t.officer, t, failing.id)).body.data.status).toBe('closed');
  });

  it('with "Needs approval" off, submitting approves and raises actions', async () => {
    const t = await team();
    const template = await publishedTemplate(t, { needsApproval: false });
    const inspection = await start(t, template);
    await captureWithFail(t, inspection.id, t.engineer.id);
    const submitted = await move(t.inspector, t, inspection.id, {
      to: 'submit',
      findingChoices: [{ itemKey: keys.b, decision: 'raise_action' }],
    });
    expect(submitted.status, JSON.stringify(submitted.body.error)).toBe(200);
    expect(submitted.body.data.status).toBe('approved');
    expect(submitted.body.data.approvedOnSubmit).toBe(true);
    expect(submitted.body.data.findings[0]?.actions).toHaveLength(1);
  });

  it('applies visibility, reassignment, cancellation and the counts', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const planned = await plan(t, template);
    // A worker (no inspection permissions) sees nothing and can't start.
    const workerList = await t.worker.client.call<InspectionPageDto>('GET', base(t));
    expect(workerList.body.data.items).toHaveLength(0);
    expect((await get(t.worker, t, planned.id)).status).toBe(404);
    expect(
      (await t.worker.client.call('POST', base(t), { body: { mode: 'start', templateVersionId: template.currentVersionId } }))
        .status,
    ).toBe(403);

    // Reassign to someone who can't conduct → refused; to the engineer → notified.
    expect((await move(t.officer, t, planned.id, { to: 'reassign', inspectorId: t.worker.id })).body.error?.code).toBe(
      'INSPECTION_INSPECTOR_NOT_ELIGIBLE',
    );
    const reassigned = await move(t.officer, t, planned.id, { to: 'reassign', inspectorId: t.engineer.id });
    expect(reassigned.body.data.inspector.id).toBe(t.engineer.id);

    const list = await t.officer.client.call<InspectionPageDto>('GET', base(t));
    expect(list.body.data.counts.today).toBe(1);
    expect(list.body.data.canPlan).toBe(true);

    const cancelled = await move(t.officer, t, planned.id, { to: 'cancel', reason: 'Area closed today' });
    expect(cancelled.body.data.cancelled).toBe(true);
    expect((await move(t.engineer, t, planned.id, { to: 'start' })).body.error?.code).toBe('INSPECTION_LOCKED');
    expect((await t.officer.client.call<InspectionPageDto>('GET', base(t))).body.data.counts.today).toBe(0);
  });
});

// ---- Offline (T-80) --------------------------------------------------------------------------

describe('T-80 offline capture', () => {
  it('a start, item results and a photo sent twice are applied once', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const id = crypto.randomUUID();
    const startKey = crypto.randomUUID();
    const send = () =>
      t.inspector.client.raw('POST', base(t), {
        body: JSON.stringify({ mode: 'start', id, templateVersionId: template.currentVersionId }),
        headers: { 'content-type': 'application/json', ...offline(startKey) },
      });
    const first = await send();
    expect(first.status).toBe(201);
    const second = await send();
    expect(second.status).toBe(201);
    expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await count('SELECT count(*) AS n FROM inspection WHERE id = ?', id)).toBe(1);
    expect(
      await count("SELECT count(*) AS n FROM audit_log WHERE entity_id = ? AND action = 'inspection.started'", id),
    ).toBe(1);

    const itemKey = crypto.randomUUID();
    const a1 = await answer(t.inspector, t, id, keys.a, { result: 'pass' }, offline(itemKey));
    const a2 = await answer(t.inspector, t, id, keys.a, { result: 'pass' }, offline(itemKey));
    expect([a1.status, a2.status, a2.replayed]).toEqual([200, 200, true]);

    const photoKey = crypto.randomUUID();
    expect((await photo(t.inspector, t, id, keys.b, offline(photoKey))).status).toBe(201);
    expect((await photo(t.inspector, t, id, keys.b, offline(photoKey))).replayed).toBe(true);
    expect(await count('SELECT count(*) AS n FROM inspection_file WHERE inspection_id = ?', id)).toBe(1);

    const dto = (await get(t.inspector, t, id)).body.data;
    expect(dto.offline).toBe(true);
  });

  it('a stale item update conflicts for that item only', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const inspection = await start(t, template);
    const v1 = await answer(t.inspector, t, inspection.id, keys.a, { result: 'pass' });
    expect(v1.body.data.version).toBe(1);
    await answer(t.inspector, t, inspection.id, keys.a, { comment: 'Checked twice', baseVersion: 1 });
    const stale = await answer(t.inspector, t, inspection.id, keys.a, { result: 'fail', baseVersion: 1 }, offline());
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('SYNC_CONFLICT');
    expect(
      await count(
        "SELECT count(*) AS n FROM sync_conflict WHERE entity_type = 'inspection_item' AND entity_id = ?",
        `${inspection.id}:${keys.a}`,
      ),
    ).toBe(1);
    // Another item is unaffected.
    expect((await answer(t.inspector, t, inspection.id, keys.c, { result: 'pass', baseVersion: 1 }, offline())).status).toBe(200);
  });

  it('accepts a superseded version from offline within the window only', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const oldVersion = template.currentVersionId;
    const draft = await t.admin.call<TemplateDetailDto>('POST', `/inspection-templates/${template.id}/draft`);
    void draft;
    await t.admin.call('POST', `/inspection-templates/${template.id}/publish`);

    const online = await t.inspector.client.call('POST', base(t), {
      body: { mode: 'start', templateVersionId: oldVersion },
    });
    expect(online.body.error?.code).toBe('TEMPLATE_VERSION_NOT_ALLOWED');

    const accepted = await t.inspector.client.raw('POST', base(t), {
      body: JSON.stringify({ mode: 'start', id: crypto.randomUUID(), templateVersionId: oldVersion }),
      headers: { 'content-type': 'application/json', ...offline(crypto.randomUUID(), new Date(Date.now() - DAY_MS)) },
    });
    expect(accepted.status).toBe(201);

    await harness.env.DB.prepare(
      'UPDATE inspection_template_version SET superseded_at = ? WHERE id = ?',
    )
      .bind(Date.now() - 10 * DAY_MS, oldVersion)
      .run();
    const late = await t.inspector.client.raw('POST', base(t), {
      body: JSON.stringify({ mode: 'start', id: crypto.randomUUID(), templateVersionId: oldVersion }),
      headers: { 'content-type': 'application/json', ...offline() },
    });
    expect(late.status).toBe(422);
  });

  it("refuses the first inspector's offline changes after a reassignment", async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const planned = await plan(t, template);
    await move(t.inspector, t, planned.id, { to: 'start' });
    await move(t.officer, t, planned.id, { to: 'reassign', inspectorId: t.engineer.id });
    const refused = await answer(t.inspector, t, planned.id, keys.a, { result: 'pass' }, offline());
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('INSPECTION_NOT_INSPECTOR');
  });
});

// ---- Places, read-only, the daily job ---------------------------------------------------------

describe('PLT-32 platform rules', () => {
  it('a place used by an inspection cannot be deleted; area required is enforced', async () => {
    const t = await team();
    const area = await t.admin.call<{ id: string }>('POST', `/projects/${t.projectId}/places`, {
      body: { level: 'area', name: 'Block A' },
    });
    expect(area.status).toBe(201);
    const template = await publishedTemplate(t, { areaRequired: true });
    const missing = await t.inspector.client.call('POST', base(t), {
      body: { mode: 'start', templateVersionId: template.currentVersionId },
    });
    expect(missing.body.error?.code).toBe('PLACE_REQUIRED');
    const started = await t.inspector.client.call<InspectionDto>('POST', base(t), {
      body: { mode: 'start', templateVersionId: template.currentVersionId, place: { areaId: area.body.data.id } },
    });
    expect(started.status).toBe(201);
    expect((await t.admin.call('DELETE', `/projects/${t.projectId}/places/${area.body.data.id}`)).body.error?.code).toBe(
      'PLACE_IN_USE',
    );
  });

  it('refuses inspection writes for a read-only company', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    await makeReadOnly(t.target);
    const refused = await t.inspector.client.call('POST', base(t), {
      body: { mode: 'start', templateVersionId: template.currentVersionId },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  it('notifies the inspector and planner once when a planned inspection is overdue', async () => {
    const t = await team();
    const template = await publishedTemplate(t);
    const planned = await plan(t, template);
    const later = () => Date.now() + 2 * DAY_MS;
    await inspectionDueJob.run(jobContext(later));
    await inspectionDueJob.run(jobContext(later));
    expect(
      await count(
        "SELECT count(*) AS n FROM notification WHERE type = 'inspection.overdue' AND entity_id = ?",
        planned.id,
      ),
    ).toBe(2);
  });
});
