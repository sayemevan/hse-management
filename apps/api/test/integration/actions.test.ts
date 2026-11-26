import {
  type ActionDto,
  type ActionPageDto,
  type ActionSummaryDto,
  addIsoDays,
  type CommentDto,
  type CommentPageDto,
  type MyActionsPageDto,
  type NotificationPageDto,
  type PlaceDto,
  type TimelinePageDto,
  zonedIsoDate,
} from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config';
import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { UnitOfWork } from '../../src/database/unit-of-work';
import {
  ActionContext,
  actionDueJob,
  ActionEngine,
  registerActionSource,
  withActionNumber,
} from '../../src/modules/action';
import { PermissionResolver } from '../../src/modules/identity';
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

interface Team {
  target: SeededCompany;
  projectId: string;
  projectCode: string;
  admin: TestClient;
  officer: { id: string; client: TestClient };
  engineer: { id: string; client: TestClient };
  manager: { id: string; client: TestClient };
  worker: { id: string; client: TestClient };
}

/** A project with a Safety Officer, a Site Engineer, a Worker (project roles) and an HSE Manager. */
async function team(): Promise<Team> {
  const target = await company();
  const { client: admin } = await signedIn(target, 'company_administrator');
  const project = await createProject(admin);
  const member = async (role: 'safety_officer' | 'site_engineer' | 'worker') => {
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
    officer: await member('safety_officer'),
    engineer: await member('site_engineer'),
    worker: await member('worker'),
    manager: { id: hm.id, client: manager },
  };
}

async function create(
  client: TestClient,
  projectId: string,
  body: Record<string, unknown>,
): Promise<ActionDto> {
  const result = await client.call<ActionDto>('POST', `/projects/${projectId}/actions`, {
    body: { title: 'Missing guardrail on level 3', dueOn: addIsoDays(today(), 2), ...body },
  });
  expect(result.status, JSON.stringify(result.body.error)).toBe(201);
  return result.body.data;
}

async function move(
  client: TestClient,
  t: Team,
  actionId: string,
  body: Record<string, unknown>,
) {
  return client.call<ActionDto>('POST', `/projects/${t.projectId}/actions/${actionId}/transitions`, {
    body,
  });
}

async function upload(client: TestClient, t: Team, actionId: string, count = 1) {
  const form = new FormData();
  for (let i = 0; i < count; i += 1) form.append('files', new File([PNG], `photo-${String(i)}.png`));
  const response = await client.raw('POST', `/projects/${t.projectId}/actions/${actionId}/files`, {
    body: form,
  });
  return {
    status: response.status,
    body: await response.json<{ data: ActionDto; error?: { code: string } }>(),
  };
}

async function notifications(client: TestClient) {
  return (await client.call<NotificationPageDto>('GET', '/notifications')).body.data.items;
}

describe('US-053 create action', () => {
  it('creates numbered, assigned actions and tells the owner', async () => {
    const t = await team();
    const first = await create(t.officer.client, t.projectId, {
      priority: 'high',
      ownerId: t.engineer.id,
      collaboratorIds: [t.worker.id],
    });
    expect(first).toMatchObject({
      reference: `${t.projectCode}-ACT-0001`,
      status: 'open',
      type: 'corrective',
      priority: 'high',
      dueState: 'due_soon',
      source: { module: 'manual' },
      owner: { id: t.engineer.id, hasAccess: true },
    });
    expect(first.collaborators.map((c) => c.id)).toEqual([t.worker.id]);
    const second = await create(t.officer.client, t.projectId, { ownerId: t.officer.id });
    expect(second.reference).toBe(`${t.projectCode}-ACT-0002`);

    const engineerNotes = await notifications(t.engineer.client);
    expect(engineerNotes.map((n) => n.type)).toContain('action.assigned');
    expect((await notifications(t.worker.client)).map((n) => n.type)).toContain(
      'action.collaborator_added',
    );
    // The creator who is also the owner isn't told about their own change (T-41).
    expect((await notifications(t.officer.client)).map((n) => n.type)).not.toContain(
      'action.assigned',
    );
    const timeline = await t.admin.call<TimelinePageDto>(
      'GET',
      `/projects/${t.projectId}/timeline?type=actions`,
    );
    expect(timeline.body.data.items.map((e) => e.action)).toEqual([
      'action.created',
      'action.created',
    ]);
  });

  it('applies the field, owner and project rules', async () => {
    const t = await team();
    const post = (body: Record<string, unknown>) =>
      t.officer.client.call('POST', `/projects/${t.projectId}/actions`, {
        body: { title: 'Fix the ladder', ownerId: t.engineer.id, dueOn: today(), ...body },
      });
    expect((await post({ dueOn: addIsoDays(today(), -1) })).body.error?.code).toBe(
      'ACTION_DUE_DATE_INVALID',
    );
    expect((await post({ dueOn: addIsoDays(today(), 800) })).body.error?.code).toBe(
      'ACTION_DUE_DATE_INVALID',
    );
    expect((await post({ title: 'Fix' })).status).toBe(422);
    const { account: outsider } = await signedIn(t.target, 'supervisor');
    expect((await post({ ownerId: outsider.id })).body.error?.code).toBe(
      'ACTION_OWNER_NOT_ELIGIBLE',
    );
    const many = await Promise.all(
      Array.from({ length: 6 }, async () => (await signedIn(t.target, 'hse_manager')).account.id),
    );
    expect((await post({ collaboratorIds: many })).body.error?.code).toBe(
      'ACTION_COLLABORATOR_LIMIT',
    );
    // Workers can't create (O-107).
    const refused = await t.worker.client.call('POST', `/projects/${t.projectId}/actions`, {
      body: { title: 'Fix the ladder', ownerId: t.worker.id, dueOn: today() },
    });
    expect(refused.status).toBe(403);

    const planning = await createProject(t.admin, { status: 'planning' });
    const onPlanning = await t.admin.call('POST', `/projects/${planning.id}/actions`, {
      body: { title: 'Fix the ladder', ownerId: t.manager.id, dueOn: today() },
    });
    expect(onPlanning.body.error?.code).toBe('PROJECT_NOT_ACCEPTING_RECORDS');
  });

  it('gives concurrent actions distinct consecutive numbers (T-60)', async () => {
    const t = await team();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        t.officer.client.call<ActionDto>('POST', `/projects/${t.projectId}/actions`, {
          body: { title: `Concurrent action ${String(i)}`, ownerId: t.officer.id, dueOn: today() },
        }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results
      .map((r) => Number(r.body.data.reference.split('-ACT-')[1]))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('lets source modules create actions in their own batch, all or nothing (T-57)', async () => {
    const t = await team();
    registerActionSource({
      module: 'test_source',
      describe: () => Promise.resolve({ label: 'Test record 7', href: null, projectId: t.projectId }),
    });
    const db = createDatabase(harness.env.DB);
    const ctx = new ActionContext({
      db,
      meta: { requestId: 'test', ipAddress: null, userAgent: null },
      clock: Date.now,
      bucket: harness.env.FILES,
      resolver: new PermissionResolver(db),
    });
    const project = { id: t.projectId, code: t.projectCode, status: 'active' as const };
    const input = {
      tenant: {
        id: t.target.id,
        name: 'x',
        slug: 'x',
        defaultLanguage: 'en' as const,
        timeZone: 'Asia/Riyadh',
        logoFileId: null,
        readOnly: false,
      },
      project,
      source: { module: 'test_source', recordId: crypto.randomUUID() },
      type: 'corrective' as const,
      priority: 'medium' as const,
      title: 'From the test source',
      ownerId: t.engineer.id,
      dueOn: today(),
      createdBy: t.officer.id,
    };
    // A failing statement in the same batch: nothing is left behind.
    await expect(
      withActionNumber(async () => {
        const prepared = await new ActionEngine(ctx).prepare(input);
        await new UnitOfWork(db)
          .add(...prepared.statements, db.run(`select json('boom')` as never))
          .commit();
      }),
    ).rejects.toThrow();
    const list = await t.officer.client.call<ActionPageDto>('GET', `/projects/${t.projectId}/actions`);
    expect(list.body.data.items).toEqual([]);

    const created = await withActionNumber(async () => {
      const prepared = await new ActionEngine(ctx).prepare(input);
      await new UnitOfWork(db).add(...prepared.statements).commit();
      return prepared;
    });
    expect(created.reference).toBe(`${t.projectCode}-ACT-0001`);
    const detail = await t.officer.client.call<ActionDto>(
      'GET',
      `/projects/${t.projectId}/actions/${created.row.id}`,
    );
    expect(detail.body.data.source).toMatchObject({ module: 'test_source', label: 'Test record 7' });
  });
});

describe('US-054 – US-058 workflow (T-58)', () => {
  it('runs the whole flow with evidence, send-back, verification and closure', async () => {
    const t = await team();
    const action = await create(t.officer.client, t.projectId, {
      priority: 'high',
      ownerId: t.engineer.id,
    });
    const id = action.id;
    expect(action.allowedTransitions).toEqual([]);

    const asOwner = await t.engineer.client.call<ActionDto>(
      'GET',
      `/projects/${t.projectId}/actions/${id}`,
    );
    expect(asOwner.body.data.allowedTransitions).toEqual(['start', 'complete']);
    expect((await move(t.engineer.client, t, id, { transition: 'start' })).body.data.status).toBe(
      'in_progress',
    );

    // Progress with a photo (US-055).
    const uploaded = await upload(t.engineer.client, t, id);
    expect(uploaded.status, JSON.stringify(uploaded.body.error)).toBe(201);
    const fileId = uploaded.body.data.files[0]?.id ?? '';
    const progress = await t.engineer.client.call<ActionDto>(
      'POST',
      `/projects/${t.projectId}/actions/${id}/updates`,
      { body: { note: 'Scaffold ordered', percent: 30, fileIds: [fileId] } },
    );
    expect(progress.status).toBe(201);
    expect(progress.body.data.progressPercent).toBe(30);

    // High priority needs evidence (O-103).
    const bare = await move(t.engineer.client, t, id, {
      transition: 'complete',
      note: 'Guardrail installed on level 3',
    });
    expect(bare.body.error?.code).toBe('ACTION_EVIDENCE_REQUIRED');
    const done = await move(t.engineer.client, t, id, {
      transition: 'complete',
      note: 'Guardrail installed on level 3',
      evidenceFileIds: [fileId],
    });
    expect(done.body.data).toMatchObject({ status: 'completed', dueState: 'done', progressPercent: 100 });
    // The creator (a verifier) is told (O-109).
    expect((await notifications(t.officer.client)).map((n) => n.type)).toContain(
      'action.verification_needed',
    );

    // Send back with a reason (US-057).
    expect((await move(t.officer.client, t, id, { transition: 'send_back', reason: 'short' })).status).toBe(422);
    const back = await move(t.officer.client, t, id, {
      transition: 'send_back',
      reason: 'Toe board is still missing on the east side.',
    });
    expect(back.body.data).toMatchObject({ status: 'in_progress', sendBackCount: 1, progressPercent: 30 });
    expect(back.body.data.sentBackReason).toContain('Toe board');

    await move(t.engineer.client, t, id, {
      transition: 'complete',
      note: 'Toe board added on the east side',
      evidenceFileIds: [fileId],
    });
    // Close needs Verified first.
    expect((await move(t.manager.client, t, id, { transition: 'close' })).body.error?.code).toBe(
      'ACTION_TRANSITION_NOT_ALLOWED',
    );
    const closed = await move(t.manager.client, t, id, {
      transition: 'verify_and_close',
      method: 'site_visit',
    });
    expect(closed.body.data).toMatchObject({
      status: 'closed',
      verificationMethod: 'site_visit',
      verifiedBy: { id: t.manager.id },
      closedBy: { id: t.manager.id },
    });
    expect(closed.body.data.can).toMatchObject({ comment: false, addProgress: false, followUp: true });

    // Locked (O-105).
    const edit = await t.officer.client.call('PATCH', `/projects/${t.projectId}/actions/${id}`, {
      body: { title: 'Changed after closing' },
    });
    expect(edit.body.error?.code).toBe('ACTION_LOCKED');
    const comment = await t.engineer.client.call(
      'POST',
      `/projects/${t.projectId}/actions/${id}/comments`,
      { body: { body: 'Late comment' } },
    );
    expect(comment.body.error?.code).toBe('COMMENTS_LOCKED');

    // Follow-up (O-97).
    const followUp = await create(t.officer.client, t.projectId, {
      ownerId: t.engineer.id,
      followUpOf: id,
    });
    expect(followUp.source).toMatchObject({ module: 'action', label: `${t.projectCode}-ACT-0001` });
    const original = await t.officer.client.call<ActionDto>(
      'GET',
      `/projects/${t.projectId}/actions/${id}`,
    );
    expect(original.body.data.followUps.map((f) => f.id)).toEqual([followUp.id]);

    const history = await t.officer.client.call<TimelinePageDto>(
      'GET',
      `/projects/${t.projectId}/actions/${id}/history`,
    );
    expect(history.body.data.items.map((e) => e.action).reverse()).toEqual([
      'action.created',
      'action.started',
      'action.file_added',
      'action.progress_added',
      'action.completed',
      'action.sent_back',
      'action.completed',
      'action.verified',
      'action.closed',
    ]);
  });

  it('allows each move only to the actors in the workflow', async () => {
    const t = await team();
    const action = await create(t.officer.client, t.projectId, {
      ownerId: t.officer.id,
      collaboratorIds: [t.engineer.id],
    });
    const id = action.id;
    // Only the owner starts or completes.
    expect((await move(t.engineer.client, t, id, { transition: 'start' })).status).toBe(403);
    expect((await move(t.manager.client, t, id, { transition: 'start' })).status).toBe(403);
    expect(
      (
        await move(t.engineer.client, t, id, {
          transition: 'complete',
          note: 'Done by the collaborator',
        })
      ).status,
    ).toBe(403);
    // Medium: no evidence needed; straight from Open.
    expect(
      (await move(t.officer.client, t, id, { transition: 'complete', note: 'Done by the owner' }))
        .body.data.status,
    ).toBe('completed');
    // The owner holds verify but is a participant (O-104).
    const own = await move(t.officer.client, t, id, { transition: 'verify', method: 'photo_evidence' });
    expect(own.body.error?.code).toBe('ACTION_VERIFIER_IS_PARTICIPANT');
    // Workers hold no verify.
    expect((await move(t.worker.client, t, id, { transition: 'verify', method: 'site_visit' })).status).toBe(404);
    const verified = await move(t.manager.client, t, id, { transition: 'verify', method: 'document_review' });
    expect(verified.body.data.status).toBe('verified');
    // A second verify loses the race / is no longer allowed.
    expect(
      (await move(t.manager.client, t, id, { transition: 'verify', method: 'document_review' })).body
        .error?.code,
    ).toBe('ACTION_TRANSITION_NOT_ALLOWED');
    // Site Engineers can't close.
    expect((await move(t.engineer.client, t, id, { transition: 'close' })).status).toBe(403);
    expect((await move(t.officer.client, t, id, { transition: 'close' })).body.data.status).toBe(
      'closed',
    );
  });

  it('reassigns with history, manages collaborators and voids', async () => {
    const t = await team();
    const action = await create(t.officer.client, t.projectId, { ownerId: t.engineer.id });
    const base = `/projects/${t.projectId}/actions/${action.id}`;
    expect(
      (await t.officer.client.call('POST', `${base}/owner`, { body: { ownerId: t.officer.id } }))
        .status,
    ).toBe(422);
    const changed = await t.officer.client.call<ActionDto>('POST', `${base}/owner`, {
      body: { ownerId: t.worker.id, reason: 'Worker crew handles guardrails' },
    });
    expect(changed.body.data.owner.id).toBe(t.worker.id);
    expect(changed.body.data.ownerHistory.map((h) => h.owner.id)).toEqual([t.worker.id, t.engineer.id]);
    expect((await notifications(t.engineer.client)).map((n) => n.type)).toContain('action.unassigned');

    // The owner adds a collaborator; the worker now sees the action without the view permission.
    const added = await t.worker.client.call<ActionDto>('POST', `${base}/collaborators`, {
      body: { userIds: [t.engineer.id] },
    });
    expect(added.body.data.collaborators.map((c) => c.id)).toEqual([t.engineer.id]);

    // Due date change needs a reason (O-100).
    const noReason = await t.officer.client.call('PATCH', base, {
      body: { dueOn: addIsoDays(today(), 5) },
    });
    expect(noReason.body.error?.code).toBe('ACTION_REASON_REQUIRED');
    const moved = await t.officer.client.call<ActionDto>('PATCH', base, {
      body: { dueOn: addIsoDays(today(), 5), reason: 'Material delayed' },
    });
    expect(moved.body.data.dueOn).toBe(addIsoDays(today(), 5));
    expect((await notifications(t.worker.client)).map((n) => n.type)).toContain(
      'action.due_date_changed',
    );

    const voided = await t.officer.client.call<ActionDto>('POST', `${base}/void`, {
      body: { reason: 'Duplicate of another action' },
    });
    expect(voided.body.data.voided).toBe(true);
    const list = await t.officer.client.call<ActionPageDto>('GET', `/projects/${t.projectId}/actions`);
    expect(list.body.data.items).toEqual([]);
    const withVoided = await t.officer.client.call<ActionPageDto>(
      'GET',
      `/projects/${t.projectId}/actions?voided=true`,
    );
    expect(withVoided.body.data.items.map((i) => i.id)).toEqual([action.id]);
    expect(
      (await t.worker.client.call('POST', `${base}/transitions`, { body: { transition: 'start' } }))
        .body.error?.code,
    ).toBe('ACTION_LOCKED');
  });
});

describe('PLT-24 lists and T-65 access', () => {
  it('shows workers their own actions only and fills My actions', async () => {
    const t = await team();
    const mine = await create(t.officer.client, t.projectId, { ownerId: t.worker.id, title: 'Clear the walkway' });
    await create(t.officer.client, t.projectId, { ownerId: t.engineer.id, title: 'Repair the ladder' });

    const workerList = await t.worker.client.call<ActionPageDto>('GET', `/projects/${t.projectId}/actions`);
    expect(workerList.body.data.items.map((i) => i.id)).toEqual([mine.id]);
    const officerList = await t.officer.client.call<ActionPageDto>(
      'GET',
      `/projects/${t.projectId}/actions`,
    );
    expect(officerList.body.data.items).toHaveLength(2);
    const other = officerList.body.data.items.find((i) => i.id !== mine.id);
    expect(
      (await t.worker.client.call('GET', `/projects/${t.projectId}/actions/${other?.id ?? ''}`)).status,
    ).toBe(404);

    const search = await t.officer.client.call<ActionPageDto>(
      'GET',
      `/projects/${t.projectId}/actions?search=ACT-1`,
    );
    expect(search.body.data.items.map((i) => i.id)).toEqual([mine.id]);
    const words = await t.officer.client.call<ActionPageDto>(
      'GET',
      `/projects/${t.projectId}/actions?search=ladder`,
    );
    expect(words.body.data.items).toHaveLength(1);

    const summary = await t.officer.client.call<ActionSummaryDto>(
      'GET',
      `/projects/${t.projectId}/actions/summary`,
    );
    expect(summary.body.data).toMatchObject({ open: 2, overdue: 0, toVerify: 0, closed: 0 });

    await move(t.worker.client, t, mine.id, { transition: 'complete', note: 'Walkway cleared now' });
    const toVerify = await t.manager.client.call<MyActionsPageDto>('GET', '/me/actions?tab=verify');
    expect(toVerify.body.data.items.map((i) => i.id)).toEqual([mine.id]);
    // Nothing is overdue yet: the header count must respect the due filter.
    const header = await t.engineer.client.call<{ overdue: number; dueToday: number }>(
      'GET',
      '/me/actions/summary',
    );
    expect(header.body.data).toMatchObject({ overdue: 0, dueToday: 0 });
    const owned = await t.engineer.client.call<MyActionsPageDto>('GET', '/me/actions');
    expect(owned.body.data.counts.owned).toBe(1);
    expect(owned.body.data.items[0]?.projectCode).toBe(t.projectCode);
  });

  it('keeps archived projects read-only and blocks writes in read-only mode', async () => {
    const t = await team();
    const action = await create(t.officer.client, t.projectId, { ownerId: t.officer.id });
    await makeReadOnly(t.target);
    const refused = await t.officer.client.call(
      'POST',
      `/projects/${t.projectId}/actions/${action.id}/comments`,
      { body: { body: 'In read-only mode' } },
    );
    expect(refused.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');
    expect(
      (await t.officer.client.call('GET', `/projects/${t.projectId}/actions/${action.id}`)).status,
    ).toBe(200);
  });
});

describe('PLT-22 comments', () => {
  it('posts, groups notifications, edits within 15 minutes and never deletes', async () => {
    const t = await team();
    const action = await create(t.officer.client, t.projectId, {
      ownerId: t.engineer.id,
      collaboratorIds: [t.worker.id],
    });
    const base = `/projects/${t.projectId}/actions/${action.id}/comments`;
    const first = await t.engineer.client.call<CommentDto>('POST', base, {
      body: { body: 'Scaffold arrives Sunday.' },
    });
    expect(first.status).toBe(201);
    await t.engineer.client.call('POST', base, { body: { body: 'سيتم التركيب يوم الأحد' } });
    const officerComments = (await notifications(t.officer.client)).filter(
      (n) => n.type === 'action.comment_added',
    );
    expect(officerComments).toHaveLength(1);
    expect(officerComments[0]?.params.count).toBe(2);
    expect(
      (await notifications(t.engineer.client)).filter((n) => n.type === 'action.comment_added'),
    ).toHaveLength(0);

    const page = await t.worker.client.call<CommentPageDto>('GET', base);
    expect(page.body.data.comments.map((c) => c.body)).toEqual([
      'Scaffold arrives Sunday.',
      'سيتم التركيب يوم الأحد',
    ]);
    expect(page.body.data.comments[0]?.canEdit).toBe(false);

    const edited = await t.engineer.client.call<CommentDto>('PATCH', `${base}/${first.body.data.id}`, {
      body: { body: 'Scaffold arrives Monday.' },
    });
    expect(edited.body.data.editedAt).not.toBeNull();
    expect(
      (
        await t.worker.client.call('PATCH', `${base}/${first.body.data.id}`, {
          body: { body: 'Not mine' },
        })
      ).status,
    ).toBe(403);
    await harness.env.DB.prepare('UPDATE comment SET created_at = created_at - 1000000 WHERE id = ?')
      .bind(first.body.data.id)
      .run();
    const late = await t.engineer.client.call('PATCH', `${base}/${first.body.data.id}`, {
      body: { body: 'Too late' },
    });
    expect(late.body.error?.code).toBe('COMMENT_EDIT_WINDOW_PASSED');
    await expect(
      harness.env.DB.prepare('DELETE FROM comment WHERE id = ?').bind(first.body.data.id).run(),
    ).rejects.toThrow();
  });
});

describe('files, places and append-only history', () => {
  it('serves evidence only through the action route and limits files', async () => {
    const t = await team();
    const action = await create(t.officer.client, t.projectId, { ownerId: t.engineer.id });
    const uploaded = await upload(t.engineer.client, t, action.id, 10);
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.body.data.files[0]?.id ?? '';
    const served = await t.officer.client.raw(
      'GET',
      `/projects/${t.projectId}/actions/${action.id}/files/${fileId}`,
    );
    expect(served.status).toBe(200);
    expect((await t.officer.client.raw('GET', `/files/${fileId}`)).status).toBe(404);
    await upload(t.engineer.client, t, action.id, 10);
    expect((await upload(t.engineer.client, t, action.id, 1)).body.error?.code).toBe(
      'ACTION_FILE_LIMIT',
    );
    // Not a participant: can't add files.
    expect((await upload(t.worker.client, t, action.id, 1)).status).toBe(404);
  });

  it('records places, refuses deleting a place in use and keeps updates immutable', async () => {
    const t = await team();
    const area = await t.officer.client.call<PlaceDto>('POST', `/projects/${t.projectId}/places`, {
      body: { level: 'area', name: 'Block A' },
    });
    const action = await create(t.officer.client, t.projectId, {
      ownerId: t.officer.id,
      place: { areaId: area.body.data.id },
    });
    expect(action.place).toMatchObject({ areaId: area.body.data.id, names: ['Block A'] });
    const remove = await t.officer.client.call(
      'DELETE',
      `/projects/${t.projectId}/places/${area.body.data.id}`,
    );
    expect(remove.body.error?.code).toBe('PLACE_IN_USE');
    const byPlace = await t.officer.client.call<ActionPageDto>(
      'GET',
      `/projects/${t.projectId}/actions?place=${area.body.data.id}`,
    );
    expect(byPlace.body.data.items).toHaveLength(1);

    await move(t.officer.client, t, action.id, { transition: 'start' });
    await expect(
      harness.env.DB.prepare("UPDATE action_update SET note = 'x' WHERE action_id = ?")
        .bind(action.id)
        .run(),
    ).rejects.toThrow();
    await expect(
      harness.env.DB.prepare('DELETE FROM action_update WHERE action_id = ?').bind(action.id).run(),
    ).rejects.toThrow();
  });
});

describe('T-64 reminder job', () => {
  it('sends due-tomorrow, overdue and the digest once, and flags owners without access', async () => {
    const t = await team();
    const tomorrow = await create(t.officer.client, t.projectId, {
      ownerId: t.engineer.id,
      dueOn: addIsoDays(today(), 1),
    });
    const late = await create(t.officer.client, t.projectId, {
      ownerId: t.engineer.id,
      priority: 'critical',
      dueOn: today(),
    });
    await harness.env.DB.prepare('UPDATE action SET due_on = ? WHERE id = ?')
      .bind(addIsoDays(today(), -1), late.id)
      .run();

    await actionDueJob.run(jobContext());
    await actionDueJob.run(jobContext());
    const types = (await notifications(t.engineer.client)).map((n) => n.type);
    expect(types.filter((type) => type === 'action.due_tomorrow')).toHaveLength(1);
    expect(types.filter((type) => type === 'action.overdue')).toHaveLength(1);
    expect(types.filter((type) => type === 'action.due_digest')).toHaveLength(1);
    // Critical overdue: the creator is told too.
    expect((await notifications(t.officer.client)).map((n) => n.type)).toContain('action.overdue');

    const listed = await t.officer.client.call<ActionPageDto>(
      'GET',
      `/projects/${t.projectId}/actions?due=overdue`,
    );
    expect(listed.body.data.items.map((i) => i.id)).toEqual([late.id]);
    expect(listed.body.data.items[0]).toMatchObject({ dueState: 'overdue', daysOverdue: 1 });
    expect(tomorrow.dueState).toBe('due_soon');

    // The engineer leaves the project: managers are told once (O-101).
    await harness.env.DB.prepare(
      "UPDATE user_role SET valid_until = ? WHERE user_id = ? AND scope_level = 'project'",
    )
      .bind(Date.now() - 1000, t.engineer.id)
      .run();
    await actionDueJob.run(jobContext());
    await actionDueJob.run(jobContext());
    const lost = (await notifications(t.officer.client)).filter(
      (n) => n.type === 'action.owner_lost_access',
    );
    expect(lost).toHaveLength(2);
    const noAccess = await t.officer.client.call<ActionPageDto>(
      'GET',
      `/projects/${t.projectId}/actions?noAccess=true`,
    );
    expect(noAccess.body.data.items).toHaveLength(2);
    expect(noAccess.body.data.items[0]?.owner.hasAccess).toBe(false);
  });
});
