import { type TenantDto } from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveHost } from '../../src/modules/company/tenant-host';
import { TestClient } from '../support/http';
import { seedCompany, seedUser } from '../support/seed';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;
beforeAll(async () => {
  harness = await startIntegrationEnv();
});
afterAll(async () => {
  await harness.dispose();
});

describe('resolveHost (PLT-02)', () => {
  it.each([
    ['localhost', { kind: 'platform' }],
    ['www.localhost', { kind: 'platform' }],
    ['localhost:3000', { kind: 'platform' }],
    ['acme.localhost', { kind: 'company', slug: 'acme' }],
    ['ACME.localhost:3000', { kind: 'company', slug: 'acme' }],
    ['abc.localhost', { kind: 'company', slug: 'abc' }],
    [`${'x'.repeat(30)}.localhost`, { kind: 'company', slug: 'x'.repeat(30) }],
  ])('%s', (host, expected) => {
    expect(resolveHost(host, 'localhost')).toEqual(expected);
  });

  it.each([
    'ab.localhost',
    `${'x'.repeat(31)}.localhost`,
    'admin.localhost',
    'api.localhost',
    'a.b.localhost',
    'acme.example.com',
    '-acme.localhost',
    undefined,
  ])('rejects %s', (host) => {
    expect(resolveHost(host, 'localhost')).toEqual({ kind: 'unknown' });
  });
});

describe('GET /tenant', () => {
  it('returns the public company profile on its subdomain', async () => {
    const company = await seedCompany(harness.env, { defaultLanguage: 'ar' });
    const result = await new TestClient(harness.env, company.host).call<TenantDto>(
      'GET',
      '/tenant',
    );

    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({
      context: 'company',
      company: {
        name: `Company ${company.slug}`,
        logoUrl: null,
        defaultLanguage: 'ar',
        timeZone: 'Asia/Riyadh',
        subscription: null,
      },
    });
  });

  it('returns the platform context on the base domain', async () => {
    const result = await new TestClient(harness.env, 'localhost:3000').call<TenantDto>(
      'GET',
      '/tenant',
    );
    expect(result.body.data).toEqual({ context: 'platform' });
  });

  it.each(['pending_verification', 'suspended'] as const)(
    'hides a %s company behind the same not-found answer',
    async (status) => {
      const company = await seedCompany(harness.env, { status });
      const result = await new TestClient(harness.env, company.host).call('GET', '/tenant');
      expect(result.status).toBe(404);
      expect(result.body.error.code).toBe('TENANT_NOT_FOUND');
    },
  );

  it('answers unknown and reserved subdomains with 404', async () => {
    for (const host of ['nobody-here.localhost', 'admin.localhost']) {
      const result = await new TestClient(harness.env, host).call('GET', '/tenant');
      expect(result.status).toBe(404);
      expect(result.body.error.code).toBe('TENANT_NOT_FOUND');
    }
  });

  it('ignores x-forwarded-host when it is not trusted', async () => {
    const company = await seedCompany(harness.env);
    const client = new TestClient({ ...harness.env, TRUST_FORWARDED_HOST: 'false' }, company.host);
    // Without trust, the API falls back to the Host header, which the test runtime doesn't set.
    const result = await client.call('GET', '/tenant');
    expect(result.status).toBe(404);
  });
});

describe('cross-company access', () => {
  it('rejects a token from company A on company B and audits it', async () => {
    const companyA = await seedCompany(harness.env);
    const companyB = await seedCompany(harness.env);
    const userA = await seedUser(harness.env, { companyId: companyA.id });

    const clientA = new TestClient(harness.env, companyA.host);
    expect((await clientA.login(userA.email, userA.password)).status).toBe(200);

    const clientB = new TestClient(harness.env, companyB.host);
    const result = await clientB.call('GET', '/auth/me', { token: clientA.accessToken });
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('TENANT_ACCESS_DENIED');

    const audited = await harness.env.DB.prepare(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'tenant.access.denied' AND actor_user_id = ?",
    )
      .bind(userA.id)
      .first<{ n: number }>();
    expect(audited?.n).toBe(1);
  });

  it('does not let a company user sign in on another company or the base domain', async () => {
    const companyA = await seedCompany(harness.env);
    const companyB = await seedCompany(harness.env);
    const userA = await seedUser(harness.env, { companyId: companyA.id });

    for (const host of [companyB.host, 'localhost']) {
      const result = await new TestClient(harness.env, host).login(userA.email, userA.password);
      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('lets the System Owner sign in only on the base domain (O-3)', async () => {
    const owner = await seedUser(harness.env, { companyId: null });
    const company = await seedCompany(harness.env);

    expect(
      (await new TestClient(harness.env, 'localhost').login(owner.email, owner.password)).status,
    ).toBe(200);
    expect(
      (await new TestClient(harness.env, company.host).login(owner.email, owner.password)).status,
    ).toBe(401);
  });
});
