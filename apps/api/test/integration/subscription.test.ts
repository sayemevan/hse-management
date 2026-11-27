import type {
  JobRunDto,
  PaymentDto,
  PlatformPaymentDetailDto,
  PlatformPaymentSummaryDto,
  PlatformSubscriptionDto,
  SubscriptionSummaryDto,
  TenantDto,
} from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config';
import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { dailyJobs } from '../../src/jobs';
import { subscriptionLifecycleJob } from '../../src/modules/billing';
import { DAY_MS } from '../../src/modules/subscription';
import type { JobContext } from '../../src/platform/jobs';
import { TestClient } from '../support/http';
import {
  seedCompany,
  type SeededCompany,
  seedSubscription,
  type SeedSubscriptionOptions,
  seedUser,
} from '../support/seed';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;
let owner: TestClient;
let ownerEmail: string;

beforeAll(async () => {
  harness = await startIntegrationEnv();
  const account = await seedUser(harness.env, { companyId: null });
  ownerEmail = account.email;
  owner = new TestClient(harness.env, 'localhost');
  await owner.login(account.email, account.password);
});
afterAll(async () => {
  await harness.dispose();
});

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n');
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
]);

const today = () => new Date().toISOString().slice(0, 10);

async function companyWith(subscription: SeedSubscriptionOptions | null = {}) {
  const company = await seedCompany(harness.env);
  if (subscription) await seedSubscription(harness.env, company.id, subscription);
  const admin = await seedUser(harness.env, {
    companyId: company.id,
    role: 'company_administrator',
  });
  const client = new TestClient(harness.env, company.host);
  await client.login(admin.email, admin.password);
  return { company, admin, client };
}

function submit(
  client: TestClient,
  fields: Record<string, string> = {},
  file: { bytes: Uint8Array; name: string } | null = { bytes: PDF, name: 'receipt.pdf' },
) {
  const form = new FormData();
  const values = {
    planCode: 'basic',
    billingCycle: 'monthly',
    amount: '1150.00',
    transferredOn: today(),
    reference: 'TRX-1',
    ...fields,
  };
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  if (file) form.set('file', new File([file.bytes], file.name));
  return client.raw('POST', '/subscription/payments', { body: form });
}

interface Envelope<T> {
  data: T;
  error: { code: string; params?: Record<string, unknown> };
}

async function body<T = unknown>(response: Response): Promise<Envelope<T>> {
  const parsed: unknown = await response.json();
  return parsed as Envelope<T>;
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

async function tenantOf(company: SeededCompany) {
  const client = new TestClient(harness.env, company.host);
  return (await client.call<TenantDto>('GET', '/tenant')).body.data.company?.subscription;
}

describe('PLT-13 subscription page and payment proof', () => {
  it('shows plan, state, usage, limits and bank details', async () => {
    const { client } = await companyWith();
    const result = await client.call<SubscriptionSummaryDto>('GET', '/subscription');
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      planCode: 'basic',
      state: 'trial',
      usage: { users: 1, projects: 0, storageBytes: 0 },
      limits: { users: 25, projects: 1, storageBytes: 5 * 1024 ** 3 },
      bankDetails: { iban: 'SA0380000000608010167519' },
      pendingPayment: null,
    });
  });

  it('accepts a receipt once, lists it and lets it be withdrawn', async () => {
    const { client } = await companyWith();
    const response = await submit(client, { planCode: 'pro', billingCycle: 'annual' });
    expect(response.status).toBe(201);
    const payment = (await body<PaymentDto>(response)).data;
    expect(payment).toMatchObject({ status: 'pending', planCode: 'pro', amount: 1150 });

    const second = await submit(client);
    expect(second.status).toBe(409);
    expect((await body(second)).error.code).toBe('PAYMENT_ALREADY_PENDING');

    // Every System Owner is told (PLT-15).
    const mails = await harness.mailbox.deliver();
    expect(
      mails.some((mail) => mail.to === ownerEmail && mail.subject.includes('payment proof')),
    ).toBe(true);

    const summary = await client.call<SubscriptionSummaryDto>('GET', '/subscription');
    expect(summary.body.data.pendingPayment?.id).toBe(payment.id);
    expect((await tenantOf(await companyFromClient(client)))?.paymentUnderReview).toBe(true);

    expect((await client.call('DELETE', `/subscription/payments/${payment.id}`)).status).toBe(204);
    const list = await client.call<PaymentDto[]>('GET', '/subscription/payments');
    expect(list.body.data[0]?.status).toBe('withdrawn');
    expect((await submit(client)).status).toBe(201);
  });

  it('refuses forged files, bad dates and amounts, and a downgrade over the limit', async () => {
    const { client, company } = await companyWith({ planCode: 'pro' });
    const forged = await submit(
      client,
      {},
      { bytes: new TextEncoder().encode('hello'), name: 'x.pdf' },
    );
    expect((await body(forged)).error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await submit(client, {}, null)).status).toBe(422);

    const future = new Date(Date.now() + 3 * DAY_MS).toISOString().slice(0, 10);
    expect((await submit(client, { transferredOn: future })).status).toBe(422);
    const old = new Date(Date.now() - 70 * DAY_MS).toISOString().slice(0, 10);
    expect((await submit(client, { transferredOn: old })).status).toBe(422);
    expect((await submit(client, { amount: '10.123' })).status).toBe(422);
    expect((await submit(client, { planCode: 'gold' })).status).toBe(409);

    // 26 seats on Pro, then asking for Basic (25 users) is refused (O-34).
    for (let index = 0; index < 25; index += 1) {
      await seedUser(harness.env, { companyId: company.id, role: 'worker' });
    }
    const downgrade = await submit(client, { planCode: 'basic' });
    expect(downgrade.status).toBe(409);
    expect((await body(downgrade)).error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      params: { resource: 'users' },
    });
  });

  it('is for administrators only, but every user sees the plan on the information page', async () => {
    const { company } = await companyWith();
    const worker = await seedUser(harness.env, { companyId: company.id, role: 'worker' });
    const client = new TestClient(harness.env, company.host);
    await client.login(worker.email, worker.password);
    expect((await client.call('GET', '/subscription')).status).toBe(403);
    expect((await submit(client)).status).toBe(403);
    const info = await client.call<{ subscription: { planName: string; state: string } }>(
      'GET',
      '/company',
    );
    expect(info.body.data.subscription).toMatchObject({ planName: 'Basic', state: 'trial' });
  });
});

/** The seeded company behind a client (its host is `<slug>.localhost`). */
async function companyFromClient(client: TestClient): Promise<SeededCompany> {
  const slug = client.host.split('.')[0] ?? '';
  const row = await harness.env.DB.prepare('SELECT id FROM company WHERE slug = ?')
    .bind(slug)
    .first<{ id: string }>();
  return { id: row?.id ?? '', slug, host: client.host };
}

describe('PLT-14 payment review', () => {
  it('confirms during the trial: the paid period starts when the trial ends', async () => {
    const trialEndsAt = Date.now() + 5 * DAY_MS;
    const { client, admin } = await companyWith({ trialEndsAt });
    const payment = (await body<PaymentDto>(await submit(client))).data;

    const queue = await owner.call<PlatformPaymentSummaryDto[]>('GET', '/platform/payments');
    expect(queue.body.data.some((item) => item.id === payment.id)).toBe(true);
    expect(queue.body.meta?.pendingCount).toBeGreaterThan(0);

    const detail = await owner.call<PlatformPaymentDetailDto>(
      'GET',
      `/platform/payments/${payment.id}`,
    );
    expect(detail.body.data).toMatchObject({
      fileContentType: 'application/pdf',
      status: 'pending',
    });

    const file = await owner.raw('GET', `/platform/payments/${payment.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(file.headers.get('cache-control')).toBe('private, no-store');

    const confirmed = await owner.call<PaymentDto>(
      'POST',
      `/platform/payments/${payment.id}/confirm`,
      {
        body: { billingCycle: 'annual', amountReceived: '12000' },
      },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({
      status: 'confirmed',
      confirmedBillingCycle: 'annual',
      confirmedAmount: 12000,
      periodStart: trialEndsAt,
    });

    const again = await owner.call('POST', `/platform/payments/${payment.id}/confirm`, {
      body: {},
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PAYMENT_ALREADY_REVIEWED');

    const summary = await client.call<SubscriptionSummaryDto>('GET', '/subscription');
    expect(summary.body.data).toMatchObject({ state: 'trial', billingCycle: 'annual' });
    await harness.mailbox.deliver();
    expect(harness.mailbox.latest(admin.email, 'Payment confirmed')).toBeDefined();
  });

  it('a payment in read-only mode makes the company writable at once', async () => {
    const { client, company } = await companyWith({ trialEndsAt: Date.now() - 3 * DAY_MS });
    expect((await tenantOf(company))?.state).toBe('read_only');
    const invite = {
      email: `x-${company.slug}@example.com`,
      fullName: 'New Person',
      roleCode: 'worker',
      language: 'en',
    };
    const refused = await client.call('POST', '/users/invitations', { body: invite });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');

    // Still allowed: own password, sessions, the payment itself (O-36).
    expect((await client.call('GET', '/company')).status).toBe(200);
    const payment = (await body<PaymentDto>(await submit(client))).data;
    await owner.call('POST', `/platform/payments/${payment.id}/confirm`, { body: {} });

    expect((await tenantOf(company))?.state).toBe('active');
    expect((await client.call('POST', '/users/invitations', { body: invite })).status).toBe(201);
  });

  it('rejects with a reason; the company can submit again', async () => {
    const { client, admin } = await companyWith();
    const payment = (await body<PaymentDto>(await submit(client))).data;
    const short = await owner.call('POST', `/platform/payments/${payment.id}/reject`, {
      body: { reason: 'no' },
    });
    expect(short.status).toBe(422);
    const result = await owner.call('POST', `/platform/payments/${payment.id}/reject`, {
      body: { reason: 'The amount on the receipt does not match.' },
    });
    expect(result.status).toBe(200);
    await harness.mailbox.deliver();
    expect(harness.mailbox.latest(admin.email, "couldn't confirm")?.text).toContain(
      'does not match',
    );
    const list = await client.call<PaymentDto[]>('GET', '/subscription/payments');
    expect(list.body.data[0]).toMatchObject({ status: 'rejected' });
    expect((await submit(client)).status).toBe(201);
  });

  it('a rejected proof ends the hold: the company is read-only straight away', async () => {
    const { client, company } = await companyWith({ trialEndsAt: Date.now() + DAY_MS });
    const payment = (await body<PaymentDto>(await submit(client))).data;
    // Move the trial end into the past while the proof is pending.
    await harness.env.DB.prepare('UPDATE subscription SET trial_ends_at = ? WHERE company_id = ?')
      .bind(Date.now() - DAY_MS, company.id)
      .run();
    await harness.env.DB.prepare('UPDATE payment SET submitted_at = ? WHERE id = ?')
      .bind(Date.now() - 2 * DAY_MS, payment.id)
      .run();
    expect((await tenantOf(company))?.state).toBe('trial');
    await owner.call('POST', `/platform/payments/${payment.id}/reject`, {
      body: { reason: 'Receipt is not readable, please resend.' },
    });
    expect((await tenantOf(company))?.state).toBe('read_only');
    const status = await harness.env.DB.prepare('SELECT status FROM company WHERE id = ?')
      .bind(company.id)
      .first<{ status: string }>();
    expect(status?.status).toBe('read_only');
  });

  it('is for the System Owner on the base domain only', async () => {
    const { client } = await companyWith();
    expect((await client.call('GET', '/platform/payments')).status).toBe(404);
    const overview = await owner.call<PlatformSubscriptionDto[]>(
      'GET',
      '/platform/subscriptions?state=trial',
    );
    expect(overview.status).toBe(200);
    expect(overview.body.data.every((item) => item.state === 'trial')).toBe(true);
  });
});

describe('PLT-10 / PLT-15 daily lifecycle job', () => {
  it('records read-only, syncs the company and emails once', async () => {
    const trialEndsAt = Date.now() - DAY_MS;
    const { company, admin } = await companyWith({ trialEndsAt });
    await harness.mailbox.deliver();

    await subscriptionLifecycleJob.run(jobContext());
    await subscriptionLifecycleJob.run(jobContext());
    const mails = (await harness.mailbox.deliver()).filter((mail) => mail.to === admin.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toContain('read-only');

    const row = await harness.env.DB.prepare(
      'SELECT s.status AS sub, c.status AS co FROM subscription s JOIN company c ON c.id = s.company_id WHERE c.id = ?',
    )
      .bind(company.id)
      .first<{ sub: string; co: string }>();
    expect(row).toEqual({ sub: 'read_only', co: 'read_only' });
    // Read-only began at the deadline, not when the job ran.
    const since = await harness.env.DB.prepare(
      'SELECT read_only_since AS since FROM subscription WHERE company_id = ?',
    )
      .bind(company.id)
      .first<{ since: number }>();
    expect(since?.since).toBe(trialEndsAt);
  });

  it('sends trial reminders at 7, 3 and 1 days, once each', async () => {
    const trialEndsAt = Date.now() + 10 * DAY_MS;
    const { admin } = await companyWith({ trialEndsAt });
    await harness.mailbox.deliver();
    const at = (daysLeft: number) => jobContext(() => trialEndsAt - daysLeft * DAY_MS + 60_000);

    for (const days of [9, 7, 7, 5, 3, 1, 1]) await subscriptionLifecycleJob.run(at(days));
    const subjects = (await harness.mailbox.deliver())
      .filter((mail) => mail.to === admin.email)
      .map((mail) => mail.subject);
    expect(subjects).toHaveLength(3);
    expect(subjects.every((subject) => subject.includes('trial ends'))).toBe(true);
  });

  it('starts grace after an unpaid period, then read-only', async () => {
    const periodEnd = Date.now() - DAY_MS;
    const { company, admin } = await companyWith({
      trialEndsAt: periodEnd - 40 * DAY_MS,
      status: 'active',
      billingCycle: 'monthly',
      currentPeriodStart: periodEnd - 30 * DAY_MS,
      currentPeriodEnd: periodEnd,
    });
    await harness.mailbox.deliver();
    await subscriptionLifecycleJob.run(jobContext());
    expect((await tenantOf(company))?.state).toBe('grace');
    await harness.mailbox.deliver();
    expect(harness.mailbox.latest(admin.email, 'has ended')).toBeDefined();

    await subscriptionLifecycleJob.run(jobContext(() => periodEnd + 15 * DAY_MS));
    await harness.mailbox.deliver();
    expect(harness.mailbox.latest(admin.email, 'now read-only')).toBeDefined();
  });

  it('runs every daily job and records each run (PLT-09)', async () => {
    const rows = await dailyJobs.runAll(jobContext());
    expect(rows.map((row) => row.jobName)).toEqual([
      'sessions.purge',
      'files.purge',
      'registrations.maintenance',
      'subscriptions.lifecycle',
      'projects.access_ending',
      'notifications.purge',
      'workforce.expiry',
      'actions.due',
      'sync.maintenance',
      'inspections.due',
    ]);
    expect(rows.every((row) => row.outcome === 'succeeded')).toBe(true);
    const runs = await owner.call<JobRunDto[]>('GET', '/platform/jobs');
    expect(runs.body.data.find((run) => run.name === 'subscriptions.lifecycle')?.outcome).toBe(
      'succeeded',
    );
  });
});

describe('PLT-12 storage quota', () => {
  it('refuses an upload that would pass the plan storage, and writes nothing', async () => {
    const { client, company } = await companyWith();
    // Pretend 5 GB are already used by another file.
    await harness.env.DB.prepare(
      `INSERT INTO file (id, company_id, category, storage_key, file_name, content_type, size_bytes,
         checksum, created_at, updated_at) VALUES (?, ?, 'company_logo', 'k', 'big.png', 'image/png', ?, 'x', 0, 0)`,
    )
      .bind(crypto.randomUUID(), company.id, 5 * 1024 ** 3)
      .run();
    const form = new FormData();
    form.set('file', new File([PNG], 'logo.png'));
    const response = await client.raw('PUT', '/company/logo', { body: form });
    expect(response.status).toBe(409);
    expect((await body(response)).error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      params: { resource: 'storage' },
    });
    const files = await harness.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM file WHERE company_id = ?',
    )
      .bind(company.id)
      .first<{ n: number }>();
    expect(files?.n).toBe(1);
    // Receipts don't count against the quota (PLT-13 FR-3).
    expect((await submit(client)).status).toBe(201);
  });
});
