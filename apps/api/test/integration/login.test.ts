import type { CurrentUserDto } from '@hse/shared';
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

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function auditCount(action: string, userId: string | null): Promise<number> {
  const row = await harness.env.DB.prepare(
    userId === null
      ? 'SELECT count(*) AS n FROM audit_log WHERE action = ? AND actor_user_id IS NULL'
      : 'SELECT count(*) AS n FROM audit_log WHERE action = ? AND actor_user_id = ?',
  )
    .bind(...(userId === null ? [action] : [action, userId]))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('POST /auth/login (US-001)', () => {
  it('signs in, sets the refresh cookie and returns the user', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    const client = new TestClient(harness.env, company.host);
    const result = await client.login(account.email.toUpperCase(), account.password, {
      userAgent: IPHONE_SAFARI,
      ip: '203.0.113.7',
    });

    expect(result.status).toBe(200);
    expect(result.body.data.accessToken).toBeTruthy();
    expect(result.body.data.user).toMatchObject({
      id: account.id,
      email: account.email,
      companyId: company.id,
      roles: [{ roleCode: 'safety_officer', scopeLevel: 'company', companyId: company.id }],
    });
    expect(result.setCookie).toMatch(/hse_refresh=/);
    expect(result.setCookie).toMatch(/HttpOnly/i);
    expect(result.setCookie).toMatch(/SameSite=Strict/i);
    expect(result.setCookie).toMatch(/Path=\/api\/v1\/auth/);

    const session = await harness.env.DB.prepare(
      'SELECT device_label, browser, ip_address, idle_expires_at - created_at AS idle, absolute_expires_at - created_at AS absolute FROM user_session WHERE user_id = ?',
    )
      .bind(account.id)
      .first<{
        device_label: string;
        browser: string;
        ip_address: string;
        idle: number;
        absolute: number;
      }>();
    expect(session).toEqual({
      device_label: 'iPhone',
      browser: 'Safari',
      ip_address: '203.0.113.7',
      idle: 8 * 3600 * 1000,
      absolute: 30 * 24 * 3600 * 1000,
    });
    expect(await auditCount('auth.login.succeeded', account.id)).toBe(1);

    const me = await client.call<CurrentUserDto>('GET', '/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(account.id);
  });

  it('rejects a wrong password and an unknown email with the same generic answer', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    const client = new TestClient(harness.env, company.host);

    const wrong = await client.login(account.email, 'Wrong-password-1');
    const unknown = await client.login('nobody@example.com', 'Wrong-password-1');
    for (const result of [wrong, unknown]) {
      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(result.body.message).toBe('Invalid email or password.');
    }
    expect(await auditCount('auth.login.failed', account.id)).toBe(1);
  });

  it('validates input', async () => {
    const client = new TestClient(harness.env, company.host);
    for (const body of [
      { email: '', password: '' },
      { email: 'not-an-email', password: 'x' },
      {},
    ]) {
      const result = await client.call('POST', '/auth/login', { body, token: null });
      expect(result.status).toBe(422);
      expect(result.body.error.code).toBe('VALIDATION_FAILED');
    }
    const tooLong = await client.call('POST', '/auth/login', {
      body: { email: 'a@example.com', password: 'x'.repeat(129) },
      token: null,
    });
    expect(tooLong.status).toBe(422);
  });

  it('locks the account on the 5th consecutive failure, not the 4th (D-05)', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    const client = new TestClient(harness.env, company.host);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await client.login(account.email, 'Wrong-password-1');
    }
    const fourth = await harness.env.DB.prepare('SELECT locked_until FROM user WHERE id = ?')
      .bind(account.id)
      .first<{ locked_until: number | null }>();
    expect(fourth?.locked_until).toBeNull();

    const fifth = await client.login(account.email, 'Wrong-password-1');
    expect(fifth.body.error.code).toBe('INVALID_CREDENTIALS'); // O-1: still generic
    expect(await auditCount('auth.account.locked', null)).toBeGreaterThanOrEqual(1);

    // Correct password while locked: now the lock is revealed, with minutes remaining.
    const locked = await client.login(account.email, account.password);
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    expect(locked.body.error.params?.minutes).toBe(15);
  });

  it('unlocks automatically once the lock has expired', async () => {
    const account = await seedUser(harness.env, {
      companyId: company.id,
      lockedUntil: Date.now() - 1000,
    });
    const result = await new TestClient(harness.env, company.host).login(
      account.email,
      account.password,
    );
    expect(result.status).toBe(200);
  });

  it.each(['suspended', 'archived', 'pending_invitation', 'locked'] as const)(
    'refuses a %s account, revealing it only with the correct password',
    async (status) => {
      const account = await seedUser(harness.env, { companyId: company.id, status });
      const client = new TestClient(harness.env, company.host);

      const correct = await client.login(account.email, account.password);
      expect(correct.status).toBe(403);
      expect(correct.body.error.code).toBe('ACCOUNT_INACTIVE');

      const wrong = await client.login(account.email, 'Wrong-password-1');
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    },
  );

  it('applies the per-IP rate limit (T-7)', async () => {
    const denyAll: RateLimit = { limit: () => Promise.resolve({ success: false }) };
    const client = new TestClient({ ...harness.env, AUTH_RATE_LIMITER: denyAll }, company.host);
    const result = await client.login('a@example.com', 'whatever');
    expect(result.status).toBe(429);
    expect(result.body.error.code).toBe('RATE_LIMITED');
  });

  it('upgrades a hash created with fewer iterations on successful sign-in', async () => {
    const account = await seedUser(harness.env, { companyId: company.id });
    const stronger = { ...harness.env, PASSWORD_HASH_ITERATIONS: '20000' };
    expect(
      (await new TestClient(stronger, company.host).login(account.email, account.password)).status,
    ).toBe(200);

    const row = await harness.env.DB.prepare('SELECT password_hash FROM user WHERE id = ?')
      .bind(account.id)
      .first<{ password_hash: string }>();
    expect(row?.password_hash.startsWith('pbkdf2$sha256$20000$')).toBe(true);
  });
});
