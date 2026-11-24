import { generateId, type UserListItemDto } from '@hse/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TestClient } from '../support/http';
import { tokenFrom } from '../support/mailbox';
import { seedCompany, seedSubscription, seedUser, type SeededCompany } from '../support/seed';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;

beforeAll(async () => {
  harness = await startIntegrationEnv();
});
afterAll(async () => {
  await harness.dispose();
});

const PASSWORD = 'Invited-User-9!';

async function companyWithAdmin(options: { readOnly?: boolean } = {}) {
  const company = await seedCompany(harness.env, options.readOnly ? { status: 'read_only' } : {});
  const admin = await seedUser(harness.env, {
    companyId: company.id,
    role: 'company_administrator',
  });
  const client = new TestClient(harness.env, company.host);
  await client.login(admin.email, admin.password);
  return { company, admin, client };
}

async function subscribe(company: SeededCompany, planCode: string): Promise<void> {
  await seedSubscription(harness.env, company.id, { planCode });
}

function newEmail(): string {
  return `invitee-${generateId().slice(0, 8)}@example.com`;
}

async function invite(client: TestClient, email = newEmail(), roleCode = 'safety_officer') {
  const result = await client.call<UserListItemDto>('POST', '/users/invitations', {
    body: { fullName: 'Nora Invited', email, roleCode, language: 'en' },
  });
  return { result, email };
}

describe('US-006 user invitation', () => {
  it('invites, accepts and signs in on the company subdomain', async () => {
    const { company, client, admin } = await companyWithAdmin();
    const { result, email } = await invite(client);
    expect(result.status).toBe(201);
    expect(result.body.data.status).toBe('invitation_pending');

    const sent = await harness.mailbox.deliver();
    const message = sent.find((mail) => mail.to === email);
    expect(message?.subject).toContain('invited');
    expect(message?.text).toContain(`${company.slug}.`);
    const token = tokenFrom(message);

    // Pending users can't sign in yet.
    const guest = new TestClient(harness.env, company.host);
    expect((await guest.login(email, PASSWORD)).status).toBe(401);

    const preview = await guest.call<{ email: string; companyName: string }>(
      'GET',
      `/invitations?token=${encodeURIComponent(token)}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.email).toBe(email);

    const accepted = await guest.call<{ accessToken: string; user: { email: string } }>(
      'POST',
      '/invitations/accept',
      { body: { token, password: PASSWORD } },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.user.email).toBe(email);
    expect(accepted.setCookie).toContain('hse_refresh');

    // The link works once.
    const again = await guest.call('POST', '/invitations/accept', {
      body: { token, password: PASSWORD },
    });
    expect(again.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    expect((await new TestClient(harness.env, company.host).login(email, PASSWORD)).status).toBe(
      200,
    );

    // The inviter is told.
    const notices = await harness.mailbox.deliver();
    expect(notices.some((mail) => mail.to === admin.email && mail.subject.includes('joined'))).toBe(
      true,
    );

    const list = await client.call<UserListItemDto[]>('GET', `/users?search=${email}`);
    expect(list.body.data[0]?.status).toBe('active');
  });

  it('refuses an email already used anywhere on the platform (D-08)', async () => {
    const { client } = await companyWithAdmin();
    const other = await seedCompany(harness.env);
    const existing = await seedUser(harness.env, { companyId: other.id });
    const { result } = await invite(client, existing.email);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('refuses the System Owner role (O-23) and non-administrators (PLT-08)', async () => {
    const { client, company } = await companyWithAdmin();
    const asOwner = await invite(client, newEmail(), 'system_owner');
    expect(asOwner.result.status).toBe(422);

    const worker = await seedUser(harness.env, { companyId: company.id, role: 'worker' });
    const workerClient = new TestClient(harness.env, company.host);
    await workerClient.login(worker.email, worker.password);
    expect((await invite(workerClient)).result.status).toBe(403);
    expect((await workerClient.call('GET', '/users')).status).toBe(403);
  });

  it("an administrator can't manage another company's users", async () => {
    const { admin } = await companyWithAdmin();
    const other = await seedCompany(harness.env);
    const elsewhere = new TestClient(harness.env, other.host);
    expect((await elsewhere.login(admin.email, admin.password)).status).toBe(401);
  });

  it('enforces the plan user limit (O-26)', async () => {
    const { client, company } = await companyWithAdmin();
    await subscribe(company, 'basic');
    // Basic allows 25 users: the administrator plus 24 more.
    for (let index = 0; index < 24; index += 1) {
      const { result } = await invite(client);
      expect(result.status).toBe(201);
    }
    const { result } = await invite(client);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(result.body.error.params?.resource).toBe('users');
    expect(result.body.error.params?.limit).toBe(25);
    harness.jobs.messages.splice(0);
  });

  it('resend replaces the link; cancel frees the email', async () => {
    const { client, company } = await companyWithAdmin();
    const { result, email } = await invite(client);
    const first = tokenFrom((await harness.mailbox.deliver()).find((mail) => mail.to === email));

    const resend = await client.call('POST', `/users/${result.body.data.id}/invitation/resend`);
    expect(resend.status).toBe(202);
    const second = tokenFrom((await harness.mailbox.deliver()).find((mail) => mail.to === email));
    expect(second).not.toBe(first);

    const guest = new TestClient(harness.env, company.host);
    const old = await guest.call('GET', `/invitations?token=${encodeURIComponent(first)}`);
    expect(old.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    expect((await client.call('DELETE', `/users/${result.body.data.id}/invitation`)).status).toBe(
      204,
    );
    const cancelled = await guest.call('GET', `/invitations?token=${encodeURIComponent(second)}`);
    expect(cancelled.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    // The same address can be invited again.
    expect((await invite(client, email)).result.status).toBe(201);
    harness.jobs.messages.splice(0);
  });

  it("a link for one company doesn't work on another subdomain (T-17)", async () => {
    const { client } = await companyWithAdmin();
    const { email } = await invite(client);
    const token = tokenFrom((await harness.mailbox.deliver()).find((mail) => mail.to === email));
    const other = await seedCompany(harness.env);
    const guest = new TestClient(harness.env, other.host);
    const result = await guest.call('POST', '/invitations/accept', {
      body: { token, password: PASSWORD },
    });
    expect(result.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('a read-only company cannot invite (D-30)', async () => {
    const { client } = await companyWithAdmin({ readOnly: true });
    const { result } = await invite(client);
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('COMPANY_READ_ONLY');
  });

  it('an expired invitation shows as expired and its link stops working (O-21)', async () => {
    const { client, company } = await companyWithAdmin();
    const { result, email } = await invite(client);
    const token = tokenFrom((await harness.mailbox.deliver()).find((mail) => mail.to === email));
    const past = Date.now() - 60_000;
    await harness.env.DB.prepare('UPDATE one_time_token SET expires_at = ? WHERE subject_id = ?')
      .bind(past, result.body.data.id)
      .run();
    await harness.env.DB.prepare('UPDATE user_invitation SET expires_at = ? WHERE user_id = ?')
      .bind(past, result.body.data.id)
      .run();
    const guest = new TestClient(harness.env, company.host);
    const accept = await guest.call('POST', '/invitations/accept', {
      body: { token, password: PASSWORD },
    });
    expect(accept.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    const list = await client.call<UserListItemDto[]>('GET', `/users?search=${email}`);
    expect(list.body.data[0]?.status).toBe('invitation_expired');
  });

  it('rejects a weak password at acceptance', async () => {
    const { client, company } = await companyWithAdmin();
    const { email } = await invite(client);
    const token = tokenFrom((await harness.mailbox.deliver()).find((mail) => mail.to === email));
    const guest = new TestClient(harness.env, company.host);
    const result = await guest.call('POST', '/invitations/accept', {
      body: { token, password: 'weakpass' },
    });
    expect(result.status).toBe(422);
  });

  it('records every step in the audit log', async () => {
    const { client } = await companyWithAdmin();
    const { result } = await invite(client);
    await client.call('POST', `/users/${result.body.data.id}/invitation/resend`);
    await client.call('DELETE', `/users/${result.body.data.id}/invitation`);
    const rows = await harness.env.DB.prepare(
      'SELECT action FROM audit_log WHERE entity_id = ? ORDER BY occurred_at, rowid',
    )
      .bind(result.body.data.id)
      .all<{ action: string }>();
    expect(rows.results.map((row) => row.action)).toEqual([
      'user.invited',
      'user.invitation_resent',
      'user.invitation_revoked',
    ]);
    harness.jobs.messages.splice(0);
  });

  it('only works on a company subdomain', async () => {
    const platform = new TestClient(harness.env, 'localhost');
    expect((await platform.call('GET', '/users')).status).toBe(404);
  });
});
