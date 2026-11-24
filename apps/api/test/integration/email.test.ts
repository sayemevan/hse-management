import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { UnitOfWork } from '../../src/database/unit-of-work';
import { TurnstileBotCheck } from '../../src/platform/bot-check';
import {
  collectStuckEmails,
  EmailSendError,
  type EmailSender,
  EmailService,
  processEmailJob,
  renderEmail,
  ResendEmailSender,
} from '../../src/platform/email';
import { OneTimeTokenService } from '../../src/platform/one-time-token';
import { type IntegrationEnv, startIntegrationEnv } from '../support/test-env';

let harness: IntegrationEnv;
beforeAll(async () => {
  harness = await startIntegrationEnv();
});
afterAll(async () => {
  await harness.dispose();
});

const logger = new Logger('error');

async function queueEmail(now = Date.now()) {
  const db = createDatabase(harness.env.DB);
  const enqueued = new EmailService(db, () => now).enqueue({
    template: 'registration.submitted',
    to: 'person@example.com',
    language: 'en',
    data: { applicantName: 'Sara', companyName: 'Acme' },
  });
  await new UnitOfWork(db).add(enqueued.statement).commit();
  return { db, job: enqueued.job };
}

async function statusOf(id: string) {
  return harness.env.DB.prepare(
    'SELECT status, attempts, last_error FROM email_outbox WHERE id = ?',
  )
    .bind(id)
    .first<{ status: string; attempts: number; last_error: string | null }>();
}

function sender(behaviour: () => Promise<{ messageId: string }>): EmailSender & { calls: number } {
  const recorder = {
    calls: 0,
    send: () => {
      recorder.calls += 1;
      return behaviour();
    },
  };
  return recorder;
}

describe('email consumer (PLT-05)', () => {
  it('sends a queued email once, even when the message is delivered twice', async () => {
    const { db, job } = await queueEmail();
    const ok = sender(() => Promise.resolve({ messageId: 'm-1' }));
    expect(await processEmailJob({ db, sender: ok, from: 'f@x', logger }, job)).toEqual({
      kind: 'done',
    });
    expect(await processEmailJob({ db, sender: ok, from: 'f@x', logger }, job)).toEqual({
      kind: 'done',
    });
    expect(ok.calls).toBe(1);
    expect((await statusOf(job.outboxId))?.status).toBe('sent');
  });

  it('retries temporary errors with growing delays, then gives up after 5 attempts', async () => {
    const { db, job } = await queueEmail();
    const flaky = sender(() => Promise.reject(new EmailSendError('503', true)));
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const outcome = await processEmailJob({ db, sender: flaky, from: 'f@x', logger }, job);
      if (outcome.kind === 'retry') delays.push(outcome.delaySeconds);
    }
    expect(delays).toEqual([30, 60, 120, 240]);
    expect(await statusOf(job.outboxId)).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('does not retry permanent errors', async () => {
    const { db, job } = await queueEmail();
    const rejected = sender(() => Promise.reject(new EmailSendError('422', false)));
    expect(await processEmailJob({ db, sender: rejected, from: 'f@x', logger }, job)).toEqual({
      kind: 'done',
    });
    expect((await statusOf(job.outboxId))?.status).toBe('failed');
  });

  it('marks a secret-link email failed when its secrets are missing', async () => {
    const db = createDatabase(harness.env.DB);
    const enqueued = new EmailService(db).enqueue({
      template: 'registration.verify_email',
      to: 'p@example.com',
      language: 'en',
      data: { applicantName: 'Sara', companyName: 'Acme' },
      secrets: { verifyUrl: 'http://localhost:3000/register/verify?token=abc' },
    });
    await new UnitOfWork(db).add(enqueued.statement).commit();
    const withoutSecrets = { type: 'email.send' as const, outboxId: enqueued.job.outboxId };
    await processEmailJob(
      { db, sender: sender(() => Promise.resolve({ messageId: 'x' })), from: 'f@x', logger },
      withoutSecrets,
    );
    expect((await statusOf(enqueued.job.outboxId))?.status).toBe('failed');
  });

  it('recovers stuck emails without secrets after 10 minutes (FR-5)', async () => {
    const old = Date.now() - 11 * 60_000;
    const { job } = await queueEmail(old);
    const jobs = await collectStuckEmails(createDatabase(harness.env.DB));
    expect(jobs.map((item) => item.outboxId)).toContain(job.outboxId);
  });

  it('rejects invalid template data at enqueue time', () => {
    expect(() =>
      new EmailService(createDatabase(harness.env.DB)).enqueue({
        template: 'registration.submitted',
        to: 'p@example.com',
        language: 'en',
        data: { applicantName: 'Sara' } as never,
      }),
    ).toThrow();
  });
});

describe('templates (T-12)', () => {
  it('render Arabic right-to-left and escape inserted values', () => {
    const email = renderEmail(
      'registration.submitted',
      'ar',
      { applicantName: '<script>alert(1)</script>', companyName: 'شركة' },
      undefined,
    );
    expect(email.html).toContain('dir="rtl"');
    expect(email.html).toContain('lang="ar"');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.subject).toMatch(/[؀-ۿ]/);
    expect(email.text).toContain('شركة');
  });
});

describe('ResendEmailSender (ADR-002)', () => {
  const email = { from: 'f@x', to: 't@x', subject: 's', html: '<p>h</p>', text: 't' };

  it('posts to Resend and returns the message id', async () => {
    let request: Request | undefined;
    const fetchStub: typeof fetch = (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json({ id: 'resend-1' }));
    };
    const result = await new ResendEmailSender('re_test', fetchStub).send(email);
    expect(result.messageId).toBe('resend-1');
    expect(request?.headers.get('authorization')).toBe('Bearer re_test');
  });

  it.each([
    [500, true],
    [429, true],
    [422, false],
  ])('classifies HTTP %i as retryable=%s', async (status, retryable) => {
    const fetchStub: typeof fetch = () => Promise.resolve(new Response('{}', { status }));
    await expect(new ResendEmailSender('re_test', fetchStub).send(email)).rejects.toMatchObject({
      retryable,
    });
  });
});

describe('TurnstileBotCheck (T-11)', () => {
  it('passes only when siteverify says success, and fails closed on errors', async () => {
    const answer =
      (success: boolean): typeof fetch =>
      () =>
        Promise.resolve(Response.json({ success }));
    expect(await new TurnstileBotCheck('secret', answer(true)).verify('t', '1.2.3.4')).toBe(true);
    expect(await new TurnstileBotCheck('secret', answer(false)).verify('t', null)).toBe(false);
    const broken: typeof fetch = () => Promise.reject(new Error('down'));
    expect(await new TurnstileBotCheck('secret', broken).verify('t', null)).toBe(false);
  });
});

describe('default fetch (Workers runtime)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Workers throw "Illegal invocation" when the global fetch is called as a method of another
  // object. Node doesn't, so this stub enforces the same rule.
  const workersLikeFetch = function (this: unknown): Promise<Response> {
    if (this !== undefined && this !== globalThis) {
      return Promise.reject(new TypeError('Illegal invocation'));
    }
    return Promise.resolve(Response.json({ success: true, id: 'resend-1' }));
  };

  it('TurnstileBotCheck calls the global fetch correctly', async () => {
    vi.stubGlobal('fetch', workersLikeFetch);
    expect(await new TurnstileBotCheck('secret').verify('t', null)).toBe(true);
  });

  it('ResendEmailSender calls the global fetch correctly', async () => {
    vi.stubGlobal('fetch', workersLikeFetch);
    const email = { from: 'f@x', to: 't@x', subject: 's', html: '<p>h</p>', text: 't' };
    expect((await new ResendEmailSender('re_test').send(email)).messageId).toBe('resend-1');
  });
});

describe('one-time tokens (T-10)', () => {
  it('expire at the configured time and work once', async () => {
    const issuedAt = Date.now();
    const clock = { now: issuedAt };
    const tokens = new OneTimeTokenService(createDatabase(harness.env.DB), () => clock.now);
    const issued = await tokens.issue('registration_email', 'subject-1', 24 * 3_600_000);
    await new UnitOfWork(createDatabase(harness.env.DB)).add(issued.statement).commit();

    const row = await tokens.find('registration_email', issued.token);
    if (!row) throw new Error('token not stored');
    clock.now = issuedAt + 24 * 3_600_000 - 60_000;
    expect(tokens.isUsable(row)).toBe(true);
    clock.now = issuedAt + 24 * 3_600_000 + 60_000;
    expect(tokens.isUsable(row)).toBe(false);

    clock.now = issuedAt;
    await new UnitOfWork(createDatabase(harness.env.DB)).add(tokens.consume(row)).commit();
    const used = await tokens.find('registration_email', issued.token);
    expect(used && tokens.isUsable(used)).toBe(false);
    expect(await tokens.find('registration_resubmit', issued.token)).toBeUndefined();
  });
});
