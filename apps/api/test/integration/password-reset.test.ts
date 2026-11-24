import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TestClient } from '../support/http';
import { tokenFrom } from '../support/mailbox';
import { seedCompany, seedUser, type SeededCompany } from '../support/seed';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;
let company: SeededCompany;

beforeAll(async () => {
  harness = await startIntegrationEnv();
  company = await seedCompany(harness.env);
});
afterAll(async () => {
  await harness.dispose();
});

const NEW_PASSWORD = 'Fresh-Reset-Pass-3';

async function requestLink(host: string, email: string): Promise<string | null> {
  const client = new TestClient(harness.env, host);
  const result = await client.call('POST', '/auth/forgot-password', { body: { email } });
  expect(result.status).toBe(202);
  const mail = (await harness.mailbox.deliver()).find((message) => message.to === email);
  return mail ? tokenFrom(mail) : null;
}

describe('US-002 forgot password', () => {
  it('sends a link to an active user and the same answer to anyone else', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    expect(await requestLink(company.host, account.email)).not.toBeNull();
    expect(await requestLink(company.host, 'nobody@example.com')).toBeNull();

    const pending = await seedUser(harness.env, {
      companyId: company.id,
      status: 'pending_invitation',
    });
    expect(await requestLink(company.host, pending.email)).toBeNull();
  });

  it("sends nothing for a user of another company's subdomain", async () => {
    const other = await seedCompany(harness.env);
    const account = await seedUser(harness.env, { companyId: other.id });
    expect(await requestLink(company.host, account.email)).toBeNull();
  });

  it('works for the System Owner on the base domain', async () => {
    const owner = await seedUser(harness.env, { companyId: null });
    expect(await requestLink('localhost', owner.email)).not.toBeNull();
  });

  it('stops sending after 3 requests an hour', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await requestLink(company.host, account.email)).not.toBeNull();
    }
    expect(await requestLink(company.host, account.email)).toBeNull();
  });
});

describe('US-003 reset password', () => {
  it('sets the new password, ends every session and unlocks the account', async () => {
    const account = await seedUser(harness.env, {
      companyId: company.id,
      failedLoginCount: 5,
      lockedUntil: Date.now() + 10 * 60_000,
    });
    // A device that was signed in before the lock.
    await harness.env.DB.prepare('UPDATE user SET locked_until = NULL WHERE id = ?')
      .bind(account.id)
      .run();
    const device = new TestClient(harness.env, company.host);
    await device.login(account.email, account.password);
    await harness.env.DB.prepare('UPDATE user SET locked_until = ? WHERE id = ?')
      .bind(Date.now() + 10 * 60_000, account.id)
      .run();

    const token = await requestLink(company.host, account.email);
    if (!token) throw new Error('no link');
    const client = new TestClient(harness.env, company.host);

    const preview = await client.call<{ email: string }>(
      'GET',
      `/auth/reset-password?token=${encodeURIComponent(token)}`,
    );
    expect(preview.body.data.email).toMatch(/^u•••@example\.com$/);

    const reset = await client.call<{ revokedSessions: number }>('POST', '/auth/reset-password', {
      body: { token, password: NEW_PASSWORD },
    });
    expect(reset.status).toBe(200);
    expect(reset.body.data.revokedSessions).toBe(1);

    expect((await device.call('GET', '/auth/me')).status).toBe(401);
    expect((await client.login(account.email, account.password)).status).toBe(401);
    expect((await client.login(account.email, NEW_PASSWORD)).status).toBe(200);

    const changed = (await harness.mailbox.deliver()).find(
      (mail) => mail.to === account.email && mail.subject.includes('changed'),
    );
    expect(changed).toBeDefined();
  });

  it('a link works once, and only the newest link works', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    const first = await requestLink(company.host, account.email);
    const second = await requestLink(company.host, account.email);
    if (!first || !second) throw new Error('no link');
    const client = new TestClient(harness.env, company.host);

    const old = await client.call('POST', '/auth/reset-password', {
      body: { token: first, password: NEW_PASSWORD },
    });
    expect(old.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    expect(
      (
        await client.call('POST', '/auth/reset-password', {
          body: { token: second, password: NEW_PASSWORD },
        })
      ).status,
    ).toBe(200);
    const reused = await client.call('POST', '/auth/reset-password', {
      body: { token: second, password: 'Another-Pass-4' },
    });
    expect(reused.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('an expired link is refused (O-22: 1 hour)', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    const token = await requestLink(company.host, account.email);
    await harness.env.DB.prepare(
      "UPDATE one_time_token SET expires_at = ? WHERE subject_id = ? AND purpose = 'password_reset'",
    )
      .bind(Date.now() - 60_000, account.id)
      .run();
    const client = new TestClient(harness.env, company.host);
    const result = await client.call('POST', '/auth/reset-password', {
      body: { token, password: NEW_PASSWORD },
    });
    expect(result.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('opening the link alone changes nothing', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    const token = await requestLink(company.host, account.email);
    const client = new TestClient(harness.env, company.host);
    await client.call('GET', `/auth/reset-password?token=${encodeURIComponent(token ?? '')}`);
    await client.call('GET', `/auth/reset-password?token=${encodeURIComponent(token ?? '')}`);
    expect(
      (
        await client.call('POST', '/auth/reset-password', {
          body: { token, password: NEW_PASSWORD },
        })
      ).status,
    ).toBe(200);
  });

  it('rejects the current password, a weak one, and a link from another subdomain', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    const token = await requestLink(company.host, account.email);
    const client = new TestClient(harness.env, company.host);

    const same = await client.call('POST', '/auth/reset-password', {
      body: { token, password: account.password },
    });
    expect(same.body.error.code).toBe('PASSWORD_UNCHANGED');

    const weak = await client.call('POST', '/auth/reset-password', {
      body: { token, password: 'short' },
    });
    expect(weak.status).toBe(422);

    const other = await seedCompany(harness.env);
    const elsewhere = new TestClient(harness.env, other.host);
    const foreign = await elsewhere.call('POST', '/auth/reset-password', {
      body: { token, password: NEW_PASSWORD },
    });
    expect(foreign.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });
});
