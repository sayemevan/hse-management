import { and, eq, lt } from 'drizzle-orm';

import type { Logger } from '../../core/logging/logger';
import type { Database } from '../../database/client';
import type { JobMessage } from '../jobs';
import { emailOutbox, type EmailOutboxRow } from './email-outbox.schema';
import { EmailSendError, type EmailSender } from './email-senders';
import { isEmailTemplateName, renderEmail } from './email-templates';

export const MAX_EMAIL_ATTEMPTS = 5;
const BASE_RETRY_DELAY_SECONDS = 30;
const MAX_RETRY_DELAY_SECONDS = 3_600;
const STUCK_AFTER_MS = 10 * 60_000;

export interface EmailConsumerDeps {
  db: Database;
  sender: EmailSender;
  from: string;
  logger: Logger;
  clock?: () => number;
}

export type JobOutcome = { kind: 'done' } | { kind: 'retry'; delaySeconds: number };

type EmailJob = Extract<JobMessage, { type: 'email.send' }>;

/**
 * Sends one queued email (PLT-05 FR-3, FR-4). Idempotent: an email already marked `sent`
 * is never sent again, even when the queue delivers the message twice.
 */
export async function processEmailJob(deps: EmailConsumerDeps, job: EmailJob): Promise<JobOutcome> {
  const now = (deps.clock ?? Date.now)();
  const row = await deps.db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.id, job.outboxId))
    .get();
  if (!row) {
    deps.logger.warn('email job for unknown outbox row', { outboxId: job.outboxId });
    return { kind: 'done' };
  }
  if (row.status !== 'queued') return { kind: 'done' };

  if (!isEmailTemplateName(row.template)) {
    await markFailed(deps, row, 'unknown template');
    return { kind: 'done' };
  }
  if (row.hasSecrets && !job.secrets) {
    await markFailed(deps, row, 'secret link no longer available');
    return { kind: 'done' };
  }

  try {
    const data: unknown = JSON.parse(row.data);
    const rendered = renderEmail(row.template, row.language, data, job.secrets);
    const { messageId } = await deps.sender.send({
      from: deps.from,
      to: row.recipient,
      ...rendered,
    });
    await deps.db
      .update(emailOutbox)
      .set({
        status: 'sent',
        attempts: row.attempts + 1,
        providerMessageId: messageId,
        sentAt: new Date(now),
        lastError: null,
      })
      .where(eq(emailOutbox.id, row.id));
    return { kind: 'done' };
  } catch (error) {
    const retryable = error instanceof EmailSendError && error.retryable;
    const attempts = row.attempts + 1;
    const reason = error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
    if (!retryable || attempts >= MAX_EMAIL_ATTEMPTS) {
      await markFailed(deps, row, reason);
      return { kind: 'done' };
    }
    await deps.db
      .update(emailOutbox)
      .set({ attempts, lastError: reason })
      .where(eq(emailOutbox.id, row.id));
    const delaySeconds = Math.min(
      BASE_RETRY_DELAY_SECONDS * 2 ** (attempts - 1),
      MAX_RETRY_DELAY_SECONDS,
    );
    deps.logger.warn('email send failed, will retry', { outboxId: row.id, attempts, delaySeconds });
    return { kind: 'retry', delaySeconds };
  }
}

async function markFailed(deps: EmailConsumerDeps, row: EmailOutboxRow, reason: string) {
  await deps.db
    .update(emailOutbox)
    .set({ status: 'failed', attempts: row.attempts + 1, lastError: reason })
    .where(eq(emailOutbox.id, row.id));
  deps.logger.error('email failed permanently', {
    outboxId: row.id,
    template: row.template,
    reason,
  });
}

/**
 * PLT-05 FR-5: finds emails whose queue message never arrived (never attempted, older than
 * 10 minutes). Emails without secrets are returned for re-publishing. Emails with a secret
 * link can't be rebuilt, so they are marked failed and the user asks for a new link.
 */
export async function collectStuckEmails(
  db: Database,
  now: number = Date.now(),
): Promise<JobMessage[]> {
  const stuck = await db
    .select()
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, 'queued'),
        eq(emailOutbox.attempts, 0),
        lt(emailOutbox.createdAt, new Date(now - STUCK_AFTER_MS)),
      ),
    )
    .all();

  const jobs: JobMessage[] = [];
  for (const row of stuck) {
    if (row.hasSecrets) {
      await db
        .update(emailOutbox)
        .set({ status: 'failed', lastError: 'queue message lost; secret link not recoverable' })
        .where(eq(emailOutbox.id, row.id));
    } else {
      jobs.push({ type: 'email.send', outboxId: row.id });
    }
  }
  return jobs;
}
