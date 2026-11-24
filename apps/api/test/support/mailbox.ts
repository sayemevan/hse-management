import type { Bindings } from '../../src/core/context/app-context';
import { Logger } from '../../src/core/logging/logger';
import { createDatabase } from '../../src/database/client';
import { type EmailSender, type OutgoingEmail, processEmailJob } from '../../src/platform/email';
import { type JobMessage, jobMessageSchema } from '../../src/platform/jobs';

/** A JOBS queue that only collects messages, so tests decide when jobs run. */
export class CapturingQueue {
  readonly messages: JobMessage[] = [];

  send(body: unknown): Promise<void> {
    this.messages.push(jobMessageSchema.parse(body));
    return Promise.resolve();
  }

  sendBatch(batch: Iterable<{ body: unknown }>): Promise<void> {
    for (const item of batch) this.messages.push(jobMessageSchema.parse(item.body));
    return Promise.resolve();
  }

  asQueue(): Queue {
    return this as unknown as Queue;
  }
}

/**
 * Runs every captured email job through the real consumer with a sender that records what
 * would have been sent — a test inbox.
 */
export class Mailbox {
  readonly delivered: OutgoingEmail[] = [];

  constructor(
    private readonly env: Bindings,
    private readonly queue: CapturingQueue,
  ) {}

  async deliver(): Promise<OutgoingEmail[]> {
    const sender: EmailSender = {
      send: (email) => {
        this.delivered.push(email);
        return Promise.resolve({ messageId: `test-${String(this.delivered.length)}` });
      },
    };
    const jobs = this.queue.messages.splice(0);
    const before = this.delivered.length;
    for (const job of jobs) {
      await processEmailJob(
        {
          db: createDatabase(this.env.DB),
          sender,
          from: 'test@localhost',
          logger: new Logger('error'),
        },
        job,
      );
    }
    return this.delivered.slice(before);
  }

  /** The most recent email to `to` whose subject contains `subject`. */
  latest(to: string, subject?: string): OutgoingEmail | undefined {
    return [...this.delivered]
      .reverse()
      .find((email) => email.to === to && (!subject || email.subject.includes(subject)));
  }
}

/** The token in a `?token=` link inside an email's text. */
export function tokenFrom(email: OutgoingEmail | undefined): string {
  const match = email?.text.match(/[?&]token=([A-Za-z0-9_%-]+)/);
  if (!match?.[1]) throw new Error('no token link in email');
  return decodeURIComponent(match[1]);
}
