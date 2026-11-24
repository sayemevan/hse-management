import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TestClient } from '../support/http';
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

const NEW_PASSWORD = 'New-Site-Pass-2';

async function userOnTwoDevices() {
  const account = await seedUser(harness.env, { companyId: company.id });
  const phone = new TestClient(harness.env, company.host);
  const laptop = new TestClient(harness.env, company.host);
  await phone.login(account.email, account.password);
  await laptop.login(account.email, account.password);
  return { account, phone, laptop };
}

describe('POST /auth/change-password (US-005)', () => {
  it('changes the password and signs out other devices only (O-4)', async () => {
    const { account, phone, laptop } = await userOnTwoDevices();

    const result = await phone.call('POST', '/auth/change-password', {
      body: { currentPassword: account.password, newPassword: NEW_PASSWORD },
    });
    expect(result.status).toBe(200);
    expect(result.body.meta?.revokedSessions).toBe(1);

    expect((await phone.call('GET', '/auth/me')).status).toBe(200);
    expect((await laptop.call('GET', '/auth/me')).status).toBe(401);

    const fresh = new TestClient(harness.env, company.host);
    expect((await fresh.login(account.email, account.password)).status).toBe(401);
    expect((await fresh.login(account.email, NEW_PASSWORD)).status).toBe(200);

    const audits = await harness.env.DB.prepare(
      "SELECT action, new_value FROM audit_log WHERE actor_user_id = ? AND action IN ('auth.password.changed', 'auth.session.revoked')",
    )
      .bind(account.id)
      .all<{ action: string; new_value: string }>();
    expect(audits.results.map((row) => row.action).sort()).toEqual([
      'auth.password.changed',
      'auth.session.revoked',
    ]);
    expect(JSON.stringify(audits.results)).not.toContain(NEW_PASSWORD);
  });

  it('rejects a wrong current password and counts it towards the lockout', async () => {
    const { phone, account } = await userOnTwoDevices();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await phone.call('POST', '/auth/change-password', {
        body: { currentPassword: 'Wrong-pass-9', newPassword: NEW_PASSWORD },
      });
      expect(result.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    }
    const fifth = await phone.call('POST', '/auth/change-password', {
      body: { currentPassword: 'Wrong-pass-9', newPassword: NEW_PASSWORD },
    });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');

    // Locked: even the right current password is refused for now.
    const locked = await phone.call('POST', '/auth/change-password', {
      body: { currentPassword: account.password, newPassword: NEW_PASSWORD },
    });
    expect(locked.status).toBe(423);
  });

  it.each([
    ['Abcde1!', 'minLength'],
    ['abcdefg1!', 'uppercase'],
    ['ABCDEFG1!', 'lowercase'],
    ['Abcdefgh!', 'number'],
    ['Abcdefgh1', 'symbol'],
    [`${'Aa1!'.repeat(32)}x`, 'maxLength'],
  ])('enforces the policy on the server: %s fails %s', async (newPassword, rule) => {
    const { phone, account } = await userOnTwoDevices();
    const result = await phone.call('POST', '/auth/change-password', {
      body: { currentPassword: account.password, newPassword },
    });
    expect(result.status).toBe(422);
    expect(result.body.error.details?.map((issue) => issue.message)).toContain(rule);
  });

  it('accepts the 8- and 128-character boundaries', async () => {
    for (const newPassword of ['Abcdef1!', 'Aa1!'.repeat(32)]) {
      const { phone, account } = await userOnTwoDevices();
      const result = await phone.call('POST', '/auth/change-password', {
        body: { currentPassword: account.password, newPassword },
      });
      expect(result.status).toBe(200);
    }
  });

  it('rejects reusing the current password', async () => {
    const { phone, account } = await userOnTwoDevices();
    const result = await phone.call('POST', '/auth/change-password', {
      body: { currentPassword: account.password, newPassword: account.password },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('PASSWORD_UNCHANGED');
  });

  it('requires authentication', async () => {
    const result = await new TestClient(harness.env, company.host).call(
      'POST',
      '/auth/change-password',
      {
        body: { currentPassword: 'x', newPassword: NEW_PASSWORD },
      },
    );
    expect(result.status).toBe(401);
  });
});

describe('PATCH /auth/me (PLT-03)', () => {
  it('saves the language preference and rejects unsupported values', async () => {
    const { phone } = await userOnTwoDevices();
    const saved = await phone.call<{ preferredLanguage: string }>('PATCH', '/auth/me', {
      body: { preferredLanguage: 'ar' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.preferredLanguage).toBe('ar');

    expect(
      (await phone.call('PATCH', '/auth/me', { body: { preferredLanguage: 'fr' } })).status,
    ).toBe(422);
  });
});
