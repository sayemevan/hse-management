import type {
  CompanyInformationDto,
  CompanyProfileDto,
  CompanySettingsDto,
  CurrentUserDto,
  LogoDto,
  TenantDto,
} from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TestClient } from '../support/http';
import { seedCompany, seedUser, type SeededCompany } from '../support/seed';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;

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

async function signedIn(company: SeededCompany, role: 'company_administrator' | 'worker') {
  const account = await seedUser(harness.env, { companyId: company.id, role });
  const client = new TestClient(harness.env, company.host);
  await client.login(account.email, account.password);
  return { account, client };
}

function upload(client: TestClient, bytes: Uint8Array, name: string, type = 'image/png') {
  const form = new FormData();
  form.set('file', new File([bytes], name, { type }));
  return client.raw('PUT', '/company/logo', { body: form });
}

describe('US-007 my profile', () => {
  it('updates name, phone, language and time zone, not the email', async () => {
    const company = await seedCompany(harness.env);
    const { client } = await signedIn(company, 'worker');

    const result = await client.call<CurrentUserDto>('PATCH', '/auth/me', {
      body: {
        fullName: 'Omar Field',
        phone: '0501234567',
        preferredLanguage: 'ar',
        timeZone: 'Asia/Dubai',
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      fullName: 'Omar Field',
      phone: '+966501234567',
      effectiveLanguage: 'ar',
      effectiveTimeZone: 'Asia/Dubai',
      permissions: ['company.view'],
    });

    const reset = await client.call<CurrentUserDto>('PATCH', '/auth/me', {
      body: { preferredLanguage: null, timeZone: null },
    });
    expect(reset.body.data.effectiveLanguage).toBe('en');
    expect(reset.body.data.effectiveTimeZone).toBe('Asia/Riyadh');

    const email = await client.call('PATCH', '/auth/me', { body: { email: 'x@example.com' } });
    expect(email.status).toBe(422);
    const phone = await client.call('PATCH', '/auth/me', { body: { phone: '12345' } });
    expect(phone.status).toBe(422);
  });
});

describe('US-012 / US-015 company profile and information', () => {
  it('administrators edit the profile; the subdomain stays', async () => {
    const company = await seedCompany(harness.env);
    const { client } = await signedIn(company, 'company_administrator');

    const info = await client.call<CompanyInformationDto>('GET', '/company');
    expect(info.body.data.account).toBeDefined();
    const { updatedAt } = info.body.data.profile;

    const saved = await client.call<CompanyProfileDto>('PATCH', '/company', {
      body: {
        name: 'Gulf Build Co',
        registrationNumber: '1010101010',
        city: 'Jeddah',
        contactPhone: '0551112222',
        slug: 'hijacked',
        updatedAt,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      name: 'Gulf Build Co',
      slug: company.slug,
      city: 'Jeddah',
      contactPhone: '+966551112222',
    });

    // The sign-in page sees the new name at once (tenant cache invalidated).
    const tenant = await new TestClient(harness.env, company.host).call<TenantDto>(
      'GET',
      '/tenant',
    );
    expect(tenant.body.data.company?.name).toBe('Gulf Build Co');

    // A stale form is refused (FR-4).
    const stale = await client.call('PATCH', '/company', { body: { city: 'Riyadh', updatedAt } });
    expect(stale.status).toBe(409);
  });

  it('every user sees the profile; only administrators see the account or edit', async () => {
    const company = await seedCompany(harness.env);
    const { client } = await signedIn(company, 'worker');
    const info = await client.call<CompanyInformationDto>('GET', '/company');
    expect(info.status).toBe(200);
    expect(info.body.data.account).toBeUndefined();
    const edit = await client.call('PATCH', '/company', {
      body: { city: 'Dammam', updatedAt: info.body.data.profile.updatedAt },
    });
    expect(edit.status).toBe(403);
  });

  it('a read-only company cannot be edited (D-30)', async () => {
    const company = await seedCompany(harness.env, { status: 'read_only' });
    const { client } = await signedIn(company, 'company_administrator');
    const info = await client.call<CompanyInformationDto>('GET', '/company');
    const edit = await client.call('PATCH', '/company', {
      body: { city: 'Dammam', updatedAt: info.body.data.profile.updatedAt },
    });
    expect(edit.body.error.code).toBe('COMPANY_READ_ONLY');
  });
});

describe('US-013 company settings', () => {
  it('saves formats, week and working days; users follow the default language', async () => {
    const company = await seedCompany(harness.env);
    const { client } = await signedIn(company, 'company_administrator');
    const worker = await signedIn(company, 'worker');

    const current = await client.call<CompanySettingsDto>('GET', '/company/settings');
    expect(current.body.data).toMatchObject({
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '24h',
      weekStart: 0,
      workingDays: [0, 1, 2, 3, 4],
    });

    const saved = await client.call<CompanySettingsDto>('PUT', '/company/settings', {
      body: {
        defaultLanguage: 'ar',
        dateFormat: 'YYYY-MM-DD',
        timeFormat: '12h',
        weekStart: 6,
        workingDays: [6, 0, 1, 2, 3],
        updatedAt: current.body.data.updatedAt,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.workingDays).toEqual([0, 1, 2, 3, 6]);

    const me = await worker.client.call<CurrentUserDto>('GET', '/auth/me');
    expect(me.body.data.effectiveLanguage).toBe('ar');
    expect(me.body.data.companySettings?.dateFormat).toBe('YYYY-MM-DD');

    const none = await client.call('PUT', '/company/settings', {
      body: { ...saved.body.data, workingDays: [] },
    });
    expect(none.status).toBe(422);
    const stale = await client.call('PUT', '/company/settings', {
      body: { ...saved.body.data, updatedAt: current.body.data.updatedAt },
    });
    expect(stale.status).toBe(409);
  });
});

describe('US-014 / PLT-07 company logo and files', () => {
  it('uploads, serves publicly, replaces and removes the logo', async () => {
    const company = await seedCompany(harness.env);
    const { client } = await signedIn(company, 'company_administrator');

    const response = await upload(client, PNG, '../../logo.png');
    expect(response.status).toBe(200);
    const { logoUrl } = (await response.json<{ data: LogoDto }>()).data;
    expect(logoUrl).toMatch(/^\/api\/v1\/company\/logo\?v=/);

    const tenant = await new TestClient(harness.env, company.host).call<TenantDto>(
      'GET',
      '/tenant',
    );
    expect(tenant.body.data.company?.logoUrl).toBe(logoUrl);

    const anonymous = new TestClient(harness.env, company.host);
    const logo = await anonymous.raw('GET', '/company/logo', { token: null });
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect(logo.headers.get('x-content-type-options')).toBe('nosniff');
    expect(logo.headers.get('content-disposition')).toBe('inline; filename="logo.png"');
    expect(new Uint8Array(await logo.arrayBuffer())).toEqual(PNG);

    const etag = logo.headers.get('etag') ?? '';
    const cached = await anonymous.raw('GET', '/company/logo', {
      token: null,
      headers: { 'if-none-match': etag },
    });
    expect(cached.status).toBe(304);

    expect((await upload(client, PNG, 'second.png')).status).toBe(200);
    const files = await harness.env.DB.prepare(
      'SELECT deleted_at FROM file WHERE company_id = ? ORDER BY created_at, rowid',
    )
      .bind(company.id)
      .all<{ deleted_at: number | null }>();
    expect(files.results.map((row) => row.deleted_at === null)).toEqual([false, true]);

    expect((await client.raw('DELETE', '/company/logo')).status).toBe(204);
    expect((await anonymous.raw('GET', '/company/logo', { token: null })).status).toBe(404);
  });

  it('refuses forged, oversized, empty files and non-administrators', async () => {
    const company = await seedCompany(harness.env);
    const { client } = await signedIn(company, 'company_administrator');

    const forged = await upload(client, PDF, 'logo.png');
    expect(forged.status).toBe(415);
    expect((await forged.json<{ error: { code: string } }>()).error.code).toBe(
      'FILE_TYPE_NOT_ALLOWED',
    );

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await upload(client, svg, 'logo.svg', 'image/svg+xml')).status).toBe(415);

    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload(client, big, 'big.png')).status).toBe(413);
    const exact = new Uint8Array(2 * 1024 * 1024);
    exact.set(PNG);
    expect((await upload(client, exact, 'exact.png')).status).toBe(200);

    expect((await upload(client, new Uint8Array(0), 'empty.png')).status).toBe(400);

    const worker = await signedIn(company, 'worker');
    expect((await upload(worker.client, PNG, 'logo.png')).status).toBe(403);
  });

  it("never serves one company's file on another subdomain", async () => {
    const first = await seedCompany(harness.env);
    const admin = await signedIn(first, 'company_administrator');
    await upload(admin.client, PNG, 'logo.png');
    const row = await harness.env.DB.prepare(
      'SELECT id FROM file WHERE company_id = ? AND deleted_at IS NULL',
    )
      .bind(first.id)
      .first<{ id: string }>();

    expect((await admin.client.raw('GET', `/files/${row?.id ?? ''}`)).status).toBe(200);

    const second = await seedCompany(harness.env);
    const other = await signedIn(second, 'company_administrator');
    expect((await other.client.raw('GET', `/files/${row?.id ?? ''}`)).status).toBe(404);
  });
});
