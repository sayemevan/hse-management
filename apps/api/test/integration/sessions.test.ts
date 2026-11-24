import type { AccessTokenDto, SessionDto } from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config';
import { TokenService } from '../../src/core/auth/token-service';
import type { TenantContext } from '../../src/core/context/tenant';
import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { AuthService } from '../../src/modules/identity/auth.service';
import { IdentityContext } from '../../src/modules/identity/identity.context';
import { purgeEndedSessionTokens } from '../../src/modules/identity/session-maintenance';
import { SessionService } from '../../src/modules/identity/session.service';
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

const HOUR = 3_600_000;
const MINUTE = 60_000;

async function signedInClient() {
  const account = await seedUser(harness.env, { companyId: company.id });
  const client = new TestClient(harness.env, company.host);
  await client.login(account.email, account.password);
  return { account, client };
}

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const { client } = await signedInClient();
    const firstCookie = client.cookie;

    const result = await client.call<AccessTokenDto>('POST', '/auth/refresh', { token: null });
    expect(result.status).toBe(200);
    expect(result.body.data.accessToken).toBeTruthy();
    expect(client.cookie).not.toBe(firstCookie);
  });

  it('accepts a just-rotated token inside the grace window without rotating again', async () => {
    const { client } = await signedInClient();
    const oldCookie = client.cookie;
    await client.call('POST', '/auth/refresh', { token: null });

    const parallel = new TestClient(harness.env, company.host);
    parallel.cookie = oldCookie;
    const result = await parallel.call('POST', '/auth/refresh', { token: null });
    expect(result.status).toBe(200);
    expect(result.setCookie).toBeNull();
  });

  it('revokes the whole session when an old token returns after the grace window', async () => {
    const { client, account } = await signedInClient();
    const oldCookie = client.cookie;
    await client.call('POST', '/auth/refresh', { token: null });

    const attacker = new TestClient(
      { ...harness.env, REFRESH_REUSE_GRACE_SECONDS: '1' },
      company.host,
    );
    attacker.cookie = oldCookie;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const stolen = await attacker.call('POST', '/auth/refresh', { token: null });
    expect(stolen.status).toBe(401);

    // The legitimate user's newer token is dead too, and the event is audited.
    const legit = await client.call('POST', '/auth/refresh', { token: null });
    expect(legit.status).toBe(401);
    const row = await harness.env.DB.prepare(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'auth.token.reuse_detected' AND actor_user_id = ?",
    )
      .bind(account.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('requires a same-origin request (T-4)', async () => {
    const { client } = await signedInClient();
    expect(
      (await client.call('POST', '/auth/refresh', { token: null, origin: false })).status,
    ).toBe(403);
    expect(
      (await client.call('POST', '/auth/refresh', { token: null, origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
  });

  it('answers a missing cookie with SESSION_EXPIRED', async () => {
    const result = await new TestClient(harness.env, company.host).call('POST', '/auth/refresh', {
      token: null,
    });
    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe('SESSION_EXPIRED');
  });
});

describe('POST /auth/logout (US-004)', () => {
  it('ends the session so the old access token and cookie stop working', async () => {
    const { client } = await signedInClient();
    const token = client.accessToken;
    const cookie = client.cookie;

    const result = await client.call('POST', '/auth/logout');
    expect(result.status).toBe(200);
    expect(client.cookie).toBeNull();

    expect((await client.call('GET', '/auth/me', { token })).status).toBe(401);
    client.cookie = cookie;
    expect((await client.call('POST', '/auth/refresh', { token: null })).status).toBe(401);
  });

  it('is idempotent', async () => {
    const { client } = await signedInClient();
    const cookie = client.cookie;
    await client.call('POST', '/auth/logout');
    client.cookie = cookie;
    expect((await client.call('POST', '/auth/logout')).status).toBe(200);
    expect(
      (await new TestClient(harness.env, company.host).call('POST', '/auth/logout')).status,
    ).toBe(200);
  });
});

describe('session management (US-010)', () => {
  async function threeDevices() {
    const account = await seedUser(harness.env, { companyId: company.id });
    const devices = [
      new TestClient(harness.env, company.host),
      new TestClient(harness.env, company.host),
      new TestClient(harness.env, company.host),
    ];
    for (const device of devices) await device.login(account.email, account.password);
    return { account, devices: devices as [TestClient, TestClient, TestClient] };
  }

  it('lists active sessions and marks the current one', async () => {
    const { devices } = await threeDevices();
    const result = await devices[0].call<SessionDto[]>('GET', '/auth/sessions');
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveLength(3);
    expect(result.body.data.filter((session) => session.isCurrent)).toHaveLength(1);
  });

  it('ends one other session immediately', async () => {
    const { devices } = await threeDevices();
    const sessions = (await devices[0].call<SessionDto[]>('GET', '/auth/sessions')).body.data;
    const other = sessions.find((session) => !session.isCurrent);

    const result = await devices[0].call('DELETE', `/auth/sessions/${other?.id ?? ''}`);
    expect(result.status).toBe(200);
    expect((await devices[0].call<SessionDto[]>('GET', '/auth/sessions')).body.data).toHaveLength(
      2,
    );

    // Ending it again is not an error.
    expect((await devices[0].call('DELETE', `/auth/sessions/${other?.id ?? ''}`)).status).toBe(200);
  });

  it('ends all other sessions and keeps the current one', async () => {
    const { devices } = await threeDevices();
    const result = await devices[0].call('POST', '/auth/sessions/revoke-others');
    expect(result.body.meta?.revokedSessions).toBe(2);

    expect((await devices[0].call('GET', '/auth/me')).status).toBe(200);
    expect((await devices[1].call('GET', '/auth/me')).status).toBe(401);
    expect((await devices[2].call('GET', '/auth/me')).status).toBe(401);
  });

  it('refuses the current session, other users’ sessions and malformed ids', async () => {
    const { devices } = await threeDevices();
    const current = (await devices[0].call<SessionDto[]>('GET', '/auth/sessions')).body.data.find(
      (session) => session.isCurrent,
    );
    const self = await devices[0].call('DELETE', `/auth/sessions/${current?.id ?? ''}`);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_REVOKE_CURRENT_SESSION');

    const stranger = await signedInClient();
    const foreign = await devices[0].call(
      'DELETE',
      `/auth/sessions/${(await stranger.client.call<SessionDto[]>('GET', '/auth/sessions')).body.data[0]?.id ?? ''}`,
    );
    expect(foreign.status).toBe(404);

    expect((await devices[0].call('DELETE', '/auth/sessions/not-a-uuid')).status).toBe(422);
  });

  it('cuts off a suspended user on the very next request (T-2)', async () => {
    const { client, account } = await signedInClient();
    await harness.env.DB.prepare("UPDATE user SET status = 'suspended' WHERE id = ?")
      .bind(account.id)
      .run();
    const result = await client.call('GET', '/auth/me');
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('session expiry boundaries (D-04)', () => {
  const tenant = (): TenantContext => ({
    kind: 'company',
    company: {
      id: company.id,
      name: 'x',
      slug: company.slug,
      defaultLanguage: 'en',
      timeZone: 'Asia/Riyadh',
      logoFileId: null,
      readOnly: false,
    },
  });

  function servicesAt(clock: { now: number }) {
    const config = loadConfig(harness.env);
    const ctx = new IdentityContext({
      db: createDatabase(harness.env.DB),
      config,
      tenant: tenant(),
      meta: { requestId: 'test', ipAddress: null, userAgent: null },
      logger: new Logger('error'),
      queue: harness.env.JOBS,
      clock: () => clock.now,
    });
    const tokens = new TokenService(
      {
        secret: config.auth.jwtSecret,
        issuer: config.auth.issuer,
        audience: config.auth.audience,
        accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds,
      },
      () => clock.now,
    );
    return { auth: new AuthService(ctx, tokens), sessions: new SessionService(ctx), tokens };
  }

  async function sessionAt(clock: { now: number }) {
    const account = await seedUser(harness.env, { companyId: company.id });
    const login = await servicesAt(clock).auth.login(account.email, account.password);
    const principal = await servicesAt(clock).tokens.verifyAccessToken(login.accessToken);
    return { principal, login };
  }

  it('is valid at 7 h 59 min idle and expired at 8 h 01 min', async () => {
    const clock = { now: Date.now() };
    const { principal } = await sessionAt(clock);

    clock.now += 7 * HOUR + 59 * MINUTE;
    await expect(servicesAt(clock).sessions.validate(principal)).resolves.toBeTruthy();

    // That request counted as activity, so measure idle from it.
    clock.now += 8 * HOUR + MINUTE;
    await expect(servicesAt(clock).sessions.validate(principal)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('expires after 30 days even with continuous activity', async () => {
    const clock = { now: Date.now() };
    const { principal } = await sessionAt(clock);
    const start = clock.now;

    // Stay active every 6 hours (never idle), stopping before the 30-day mark.
    while (clock.now + 6 * HOUR < start + 30 * 24 * HOUR - MINUTE) {
      clock.now += 6 * HOUR;
      await servicesAt(clock).sessions.validate(principal);
    }
    clock.now = start + 30 * 24 * HOUR - MINUTE;
    await expect(servicesAt(clock).sessions.validate(principal)).resolves.toBeTruthy();

    clock.now = start + 30 * 24 * HOUR + MINUTE;
    await expect(servicesAt(clock).sessions.validate(principal)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('refuses a refresh after 8 hours idle', async () => {
    const clock = { now: Date.now() };
    const { login } = await sessionAt(clock);
    clock.now += 8 * HOUR + MINUTE;
    await expect(servicesAt(clock).auth.refresh(login.refreshToken)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('writes last activity at most once every 5 minutes (T-3)', async () => {
    const clock = { now: Date.now() };
    const { principal } = await sessionAt(clock);
    const read = async () =>
      (
        await harness.env.DB.prepare('SELECT last_activity_at AS t FROM user_session WHERE id = ?')
          .bind(principal.sessionId)
          .first<{ t: number }>()
      )?.t;
    const initial = await read();

    clock.now += 4 * MINUTE;
    await servicesAt(clock).sessions.validate(principal);
    expect(await read()).toBe(initial);

    clock.now += 2 * MINUTE;
    await servicesAt(clock).sessions.validate(principal);
    expect(await read()).toBe(clock.now);
  });
});

describe('daily maintenance (US-010 FR-5)', () => {
  it('purges refresh-token hashes of ended sessions but keeps the rows', async () => {
    const { client, account } = await signedInClient();
    await client.call('POST', '/auth/logout');
    const active = await signedInClient();

    const cleaned = await purgeEndedSessionTokens(
      createDatabase(harness.env.DB),
      new Logger('error'),
    );
    expect(cleaned).toBeGreaterThanOrEqual(1);

    const ended = await harness.env.DB.prepare(
      'SELECT refresh_token_hash AS h, revoked_reason AS r FROM user_session WHERE user_id = ?',
    )
      .bind(account.id)
      .first<{ h: string | null; r: string }>();
    expect(ended).toEqual({ h: null, r: 'logout' });

    // An active session is untouched and can still refresh.
    expect((await active.client.call('POST', '/auth/refresh', { token: null })).status).toBe(200);
  });
});
