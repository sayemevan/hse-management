import type {
  ApprovalResultDto,
  PlanDto,
  RegistrationDetailDto,
  RegistrationSummaryDto,
  ResubmissionFormDto,
  SlugAvailabilityDto,
} from '@hse/shared';
import { generateId } from '@hse/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config';
import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { RegistrationContext, runRegistrationMaintenance } from '../../src/modules/registration';
import { RegistrationService } from '../../src/modules/registration/registration.service';
import { TestClient } from '../support/http';
import { tokenFrom } from '../support/mailbox';
import { seedCompany, seedUser, type SeededUser } from '../support/seed';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;
let owner: SeededUser;
let console_: TestClient;

beforeAll(async () => {
  harness = await startIntegrationEnv();
  owner = await seedUser(harness.env, { companyId: null });
  console_ = new TestClient(harness.env, 'localhost');
  await console_.login(owner.email, owner.password);
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(() => {
  harness.jobs.messages.splice(0);
});

const DAY = 24 * 3_600_000;
const APPLICANT_PASSWORD = 'Applicant-Pass-1';

function unique(prefix: string): string {
  return `${prefix}-${generateId().slice(0, 6)}`;
}

function applicationBody(overrides: Record<string, unknown> = {}) {
  const slug = unique('acme');
  return {
    companyName: 'Acme Contracting',
    slug,
    countryCode: 'SA',
    city: 'Riyadh',
    timeZone: 'Asia/Riyadh',
    defaultLanguage: 'en',
    applicantName: 'Sara Ali',
    applicantEmail: `${slug}@applicant.test`,
    applicantPhone: '0501234567',
    planCode: 'pro',
    applicantLanguage: 'en',
    turnstileToken: 'test-token',
    password: APPLICANT_PASSWORD,
    termsAccepted: true,
    ...overrides,
  };
}

const platform = () => new TestClient(harness.env, 'localhost');

async function registerAndVerify(overrides: Record<string, unknown> = {}) {
  const body = applicationBody(overrides);
  const client = platform();
  expect((await client.call('POST', '/registrations', { body, token: null })).status).toBe(202);
  await harness.mailbox.deliver();
  const token = tokenFrom(harness.mailbox.latest(body.applicantEmail, 'Confirm'));
  expect(
    (await client.call('POST', '/registrations/verify-email', { body: { token }, token: null }))
      .status,
  ).toBe(200);
  await harness.mailbox.deliver();
  const list = await console_.call<RegistrationSummaryDto[]>(
    'GET',
    '/platform/registrations?status=submitted&pageSize=100',
  );
  const registration = list.body.data.find((item) => item.slug === body.slug);
  if (!registration) throw new Error('registration not in queue');
  return { body, registration };
}

describe('GET /plans (PLT-06)', () => {
  it('lists the three plans with the D-27 / D-28 limits', async () => {
    const result = await platform().call<PlanDto[]>('GET', '/plans');
    expect(result.body.data).toEqual([
      expect.objectContaining({
        code: 'basic',
        maxProjects: 1,
        maxUsers: 25,
        maxStorageBytes: 5 * 1024 ** 3,
        monthlyPrice: null,
      }),
      expect.objectContaining({
        code: 'pro',
        maxProjects: 5,
        maxUsers: 100,
        maxStorageBytes: 50 * 1024 ** 3,
      }),
      expect.objectContaining({
        code: 'enterprise',
        maxProjects: null,
        maxUsers: null,
        maxStorageBytes: 500 * 1024 ** 3,
      }),
    ]);
  });

  it('names plans in Arabic on request', async () => {
    const result = await platform().call<PlanDto[]>('GET', '/plans?lang=ar');
    expect(result.body.data[0]?.name).toBe('الأساسية');
  });
});

describe('US-011.1 register a company', () => {
  it('creates a pending application and emails a verification link in the applicant language', async () => {
    const body = applicationBody({ applicantLanguage: 'ar' });
    const result = await platform().call('POST', '/registrations', { body, token: null });
    expect(result.status).toBe(202);
    expect(result.body.data).toEqual({ email: body.applicantEmail });

    const [email] = await harness.mailbox.deliver();
    expect(email?.to).toBe(body.applicantEmail);
    expect(email?.html).toContain('dir="rtl"');
    expect(email?.text).toContain('/register/verify?token=');

    const row = await harness.env.DB.prepare(
      'SELECT status, applicant_phone, password_hash FROM company_registration WHERE slug = ?',
    )
      .bind(body.slug)
      .first<{ status: string; applicant_phone: string; password_hash: string }>();
    expect(row?.status).toBe('pending_email_verification');
    expect(row?.applicant_phone).toBe('+966501234567');
    expect(row?.password_hash.startsWith('pbkdf2$')).toBe(true);

    const outbox = await harness.env.DB.prepare('SELECT data FROM email_outbox WHERE recipient = ?')
      .bind(body.applicantEmail)
      .first<{ data: string }>();
    expect(outbox?.data).not.toContain('token');
  });

  it('reports slug availability live', async () => {
    const company = await seedCompany(harness.env);
    const check = async (slug: string) =>
      (
        await platform().call<SlugAvailabilityDto>(
          'GET',
          `/registrations/slug-availability?slug=${slug}`,
        )
      ).body.data;
    expect(await check(unique('free'))).toMatchObject({ available: true });
    expect(await check(company.slug)).toMatchObject({ available: false, reason: 'taken' });
    expect(await check('admin')).toMatchObject({ available: false, reason: 'reserved' });
    expect(await check('-bad-')).toMatchObject({ available: false, reason: 'invalid' });
  });

  it('holds the subdomain of an open application (O-16)', async () => {
    const first = applicationBody();
    await platform().call('POST', '/registrations', { body: first, token: null });
    const second = await platform().call('POST', '/registrations', {
      body: applicationBody({ slug: first.slug }),
      token: null,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SLUG_UNAVAILABLE');
  });

  it('answers the same for an email already in use but creates nothing (FR-7)', async () => {
    const company = await seedCompany(harness.env);
    const existing = await seedUser(harness.env, { companyId: company.id });
    const body = applicationBody({ applicantEmail: existing.email });

    const result = await platform().call('POST', '/registrations', { body, token: null });
    expect(result.status).toBe(202);
    const [email] = await harness.mailbox.deliver();
    expect(email?.subject).toContain('tried to register');
    const row = await harness.env.DB.prepare(
      'SELECT count(*) AS n FROM company_registration WHERE slug = ?',
    )
      .bind(body.slug)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('validates every field on the server', async () => {
    for (const overrides of [
      { companyName: 'A' },
      { countryCode: 'XX' },
      { applicantPhone: '123' },
      { password: 'weak' },
      { termsAccepted: false },
      { planCode: 'gold' },
    ]) {
      const result = await platform().call('POST', '/registrations', {
        body: applicationBody(overrides),
        token: null,
      });
      expect([409, 422]).toContain(result.status);
    }
  });

  it('refuses a failed bot check', async () => {
    const config = loadConfig(harness.env);
    const service = new RegistrationService(
      new RegistrationContext({
        db: createDatabase(harness.env.DB),
        config,
        meta: { requestId: 'test', ipAddress: null, userAgent: null },
        logger: new Logger('error'),
        queue: harness.jobs.asQueue(),
        cache: harness.env.CACHE,
        botCheck: { verify: () => Promise.resolve(false) },
        clock: Date.now,
      }),
    );
    const body = applicationBody();
    await expect(
      service.register({ ...body, applicantPhone: '+966501234567' } as never),
    ).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
  });

  it('does not exist on a company subdomain', async () => {
    const company = await seedCompany(harness.env);
    const result = await new TestClient(harness.env, company.host).call('POST', '/registrations', {
      body: applicationBody(),
      token: null,
    });
    expect(result.status).toBe(404);
  });
});

describe('US-011.2 verify email', () => {
  it('submits the application once and notifies every System Owner', async () => {
    const { registration } = await registerAndVerify();
    expect(registration.status).toBe('submitted');
    expect(harness.mailbox.latest(owner.email, 'New registration')).toBeTruthy();
  });

  it('treats a second click as success and rejects unknown tokens', async () => {
    const body = applicationBody();
    const client = platform();
    await client.call('POST', '/registrations', { body, token: null });
    await harness.mailbox.deliver();
    const token = tokenFrom(harness.mailbox.latest(body.applicantEmail, 'Confirm'));

    expect(
      (await client.call('POST', '/registrations/verify-email', { body: { token }, token: null }))
        .status,
    ).toBe(200);
    expect(
      (await client.call('POST', '/registrations/verify-email', { body: { token }, token: null }))
        .status,
    ).toBe(200);
    const bad = await client.call('POST', '/registrations/verify-email', {
      body: { token: 'nope' },
      token: null,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('resends a new link, invalidates the old one, and limits resends to 3 per hour', async () => {
    const body = applicationBody();
    const client = platform();
    await client.call('POST', '/registrations', { body, token: null });
    await harness.mailbox.deliver();
    const oldToken = tokenFrom(harness.mailbox.latest(body.applicantEmail, 'Confirm'));

    const resend = () =>
      client.call('POST', '/registrations/resend-verification', {
        body: { email: body.applicantEmail, language: 'en' },
        token: null,
      });
    expect((await resend()).status).toBe(202);
    expect(await harness.mailbox.deliver()).toHaveLength(1);
    const newToken = tokenFrom(harness.mailbox.latest(body.applicantEmail, 'Confirm'));

    expect(
      (
        await client.call('POST', '/registrations/verify-email', {
          body: { token: oldToken },
          token: null,
        })
      ).status,
    ).toBe(400);

    await resend();
    await resend();
    expect(await harness.mailbox.deliver()).toHaveLength(2); // 2nd and 3rd resends of the hour
    await resend();
    expect(await harness.mailbox.deliver()).toHaveLength(0); // limit reached, same answer

    expect(
      (
        await client.call('POST', '/registrations/verify-email', {
          body: { token: newToken },
          token: null,
        })
      ).status,
    ).toBe(400);
  });

  it('never reveals whether an application exists', async () => {
    const result = await platform().call('POST', '/registrations/resend-verification', {
      body: { email: 'nobody@nowhere.test', language: 'en' },
      token: null,
    });
    expect(result.status).toBe(202);
    expect(await harness.mailbox.deliver()).toHaveLength(0);
  });
});

describe('US-011.3 approve', () => {
  it('creates company, trial, administrator and role, and the applicant can sign in on the new subdomain', async () => {
    const { body, registration } = await registerAndVerify();
    const before = Date.now();

    const result = await console_.call<ApprovalResultDto>(
      'POST',
      `/platform/registrations/${registration.id}/approve`,
      { body: { phoneConfirmed: true, planCode: 'enterprise' } },
    );
    expect(result.status).toBe(200);
    expect(result.body.data.signInUrl).toBe(`http://${body.slug}.localhost:3000/login`);

    const sub = await harness.env.DB.prepare(
      `SELECT s.status, s.trial_started_at, s.trial_ends_at, p.code FROM subscription s JOIN plan p ON p.id = s.plan_id WHERE s.company_id = ?`,
    )
      .bind(result.body.data.companyId)
      .first<{ status: string; trial_started_at: number; trial_ends_at: number; code: string }>();
    expect(sub?.status).toBe('trial');
    expect(sub?.code).toBe('enterprise');
    expect((sub?.trial_ends_at ?? 0) - (sub?.trial_started_at ?? 0)).toBe(14 * DAY);
    expect(sub?.trial_started_at).toBeGreaterThanOrEqual(before);

    const [approvedEmail] = await harness.mailbox.deliver();
    expect(approvedEmail?.text).toContain(`http://${body.slug}.localhost:3000/login`);

    const applicant = new TestClient(harness.env, `${body.slug}.localhost`);
    const login = await applicant.login(body.applicantEmail, APPLICANT_PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body.data.user.roles[0]).toMatchObject({ roleCode: 'company_administrator' });

    const detail = await console_.call<RegistrationDetailDto>(
      'GET',
      `/platform/registrations/${registration.id}`,
    );
    expect(detail.body.data.status).toBe('approved');
    expect(detail.body.data.reviews[0]).toMatchObject({
      decision: 'approved',
      phoneConfirmed: true,
      newPlanCode: 'enterprise',
    });
    expect(JSON.stringify(detail.body)).not.toContain('pbkdf2');
  });

  it('requires the phone confirmation and refuses a second decision', async () => {
    const { registration } = await registerAndVerify();
    const path = `/platform/registrations/${registration.id}/approve`;
    expect((await console_.call('POST', path, { body: { phoneConfirmed: false } })).status).toBe(
      422,
    );
    expect((await console_.call('POST', path, { body: { phoneConfirmed: true } })).status).toBe(
      200,
    );
    const again = await console_.call('POST', path, { body: { phoneConfirmed: true } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REGISTRATION_ALREADY_DECIDED');
  });

  it('fails cleanly when the subdomain was taken meanwhile', async () => {
    const { body, registration } = await registerAndVerify();
    await seedCompany(harness.env, { slug: body.slug });
    const result = await console_.call(
      'POST',
      `/platform/registrations/${registration.id}/approve`,
      {
        body: { phoneConfirmed: true },
      },
    );
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('REGISTRATION_CONFLICT');
  });

  it('is limited to System Owners on the base domain', async () => {
    const company = await seedCompany(harness.env);
    const admin = await seedUser(harness.env, {
      companyId: company.id,
      role: 'company_administrator',
    });
    const companyClient = new TestClient(harness.env, company.host);
    await companyClient.login(admin.email, admin.password);

    expect((await companyClient.call('GET', '/platform/registrations')).status).toBe(404);
    expect((await platform().call('GET', '/platform/registrations', { token: null })).status).toBe(
      401,
    );

    // A platform user without the System Owner role is denied by default (T-14).
    const staff = await seedUser(harness.env, { companyId: null, role: 'auditor' });
    const staffClient = platform();
    await staffClient.login(staff.email, staff.password);
    expect((await staffClient.call('GET', '/platform/registrations')).status).toBe(403);
  });
});

describe('US-011.4 reject and US-011.5 resubmit', () => {
  it('rejects with a reason, resubmits through the link, keeps history, and can then be approved', async () => {
    const { body, registration } = await registerAndVerify();
    const reason = 'The phone number did not answer. Please give a reachable number.';

    const reject = await console_.call(
      'POST',
      `/platform/registrations/${registration.id}/reject`,
      {
        body: { reason },
      },
    );
    expect(reject.status).toBe(200);
    const [rejection] = await harness.mailbox.deliver();
    expect(rejection?.text).toContain(reason);
    const token = tokenFrom(rejection);

    const form = await platform().call<ResubmissionFormDto>(
      'GET',
      `/registrations/resubmission?token=${encodeURIComponent(token)}`,
    );
    expect(form.body.data).toMatchObject({ slug: body.slug, rejectionReason: reason });
    expect(JSON.stringify(form.body)).not.toContain('pbkdf2');

    const resubmit = await platform().call('PUT', '/registrations/resubmission', {
      body: { ...body, token, applicantPhone: '+966551112233', password: undefined },
      token: null,
    });
    expect(resubmit.status).toBe(200);
    await harness.mailbox.deliver();
    expect(harness.mailbox.latest(owner.email, 'New registration')).toBeTruthy();

    // The link works once.
    expect(
      (
        await platform().call(
          'GET',
          `/registrations/resubmission?token=${encodeURIComponent(token)}`,
        )
      ).status,
    ).toBe(400);

    const detail = await console_.call<RegistrationDetailDto>(
      'GET',
      `/platform/registrations/${registration.id}`,
    );
    expect(detail.body.data).toMatchObject({
      status: 'submitted',
      applicantPhone: '+966551112233',
    });
    expect(detail.body.data.reviews).toHaveLength(1);

    await console_.call('POST', `/platform/registrations/${registration.id}/approve`, {
      body: { phoneConfirmed: true },
    });
    // The original password still works (O-12).
    expect(
      (
        await new TestClient(harness.env, `${body.slug}.localhost`).login(
          body.applicantEmail,
          APPLICANT_PASSWORD,
        )
      ).status,
    ).toBe(200);
  });

  it('requires a 10–1000 character reason', async () => {
    const { registration } = await registerAndVerify();
    const path = `/platform/registrations/${registration.id}/reject`;
    expect((await console_.call('POST', path, { body: { reason: 'x'.repeat(9) } })).status).toBe(
      422,
    );
    expect((await console_.call('POST', path, { body: { reason: 'x'.repeat(1001) } })).status).toBe(
      422,
    );
    expect((await console_.call('POST', path, { body: { reason: 'x'.repeat(10) } })).status).toBe(
      200,
    );
  });
});

describe('housekeeping (O-15)', () => {
  function contextAt(now: number) {
    return new RegistrationContext({
      db: createDatabase(harness.env.DB),
      config: loadConfig(harness.env),
      meta: { requestId: 'cron', ipAddress: null, userAgent: null },
      logger: new Logger('error'),
      queue: harness.jobs.asQueue(),
      cache: harness.env.CACHE,
      botCheck: { verify: () => Promise.resolve(true) },
      clock: () => now,
    });
  }

  it('removes unverified applications after 7 days and releases their subdomain', async () => {
    const body = applicationBody();
    await platform().call('POST', '/registrations', { body, token: null });

    await runRegistrationMaintenance(contextAt(Date.now() + 7 * DAY - 60_000));
    const check = async () =>
      (
        await platform().call<SlugAvailabilityDto>(
          'GET',
          `/registrations/slug-availability?slug=${body.slug}`,
        )
      ).body.data.available;
    expect(await check()).toBe(false);

    await runRegistrationMaintenance(contextAt(Date.now() + 7 * DAY + 60_000));
    expect(await check()).toBe(true);
  });

  it('closes rejected applications after 30 days and kills the resubmission link', async () => {
    const { body, registration } = await registerAndVerify();
    await console_.call('POST', `/platform/registrations/${registration.id}/reject`, {
      body: { reason: 'Please provide a reachable phone number.' },
    });
    const token = tokenFrom((await harness.mailbox.deliver())[0]);

    await runRegistrationMaintenance(contextAt(Date.now() + 30 * DAY + 60_000));
    const detail = await console_.call<RegistrationDetailDto>(
      'GET',
      `/platform/registrations/${registration.id}`,
    );
    expect(detail.body.data.status).toBe('closed');
    expect(
      (
        await platform().call(
          'GET',
          `/registrations/resubmission?token=${encodeURIComponent(token)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await platform().call<SlugAvailabilityDto>(
          'GET',
          `/registrations/slug-availability?slug=${body.slug}`,
        )
      ).body.data.available,
    ).toBe(true);
  });
});
