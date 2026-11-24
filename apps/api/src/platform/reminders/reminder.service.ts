import { generateId } from '@hse/shared';
import { eq } from 'drizzle-orm';

import type { Logger } from '../../core/logging/logger';
import type { Database } from '../../database/client';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import type { EnqueuedEmail } from '../email';
import { type JobMessage, publishJobs, reminderLog } from '../jobs';

/** Reminder keys are at most this long (PLT-09 validation). */
export const REMINDER_KEY_MAX = 200;

export interface Reminder {
  /** Unique per reminder, e.g. `sub:<id>:trial_ending:7:<trial_ends_at>` (T-26). */
  key: string;
  companyId: string | null;
  template: string;
  /** One email per recipient, already enqueued through `EmailService`. */
  emails: EnqueuedEmail[];
  /** Other statements written with the reminder, e.g. in-app notifications (PLT-17). */
  statements?: Statement[];
}

export type ReminderOutcome = 'sent' | 'skipped';

/**
 * Sends a reminder at most once (PLT-09 FR-5). The `reminder_log` row and the outbox emails
 * are written in one batch; the unique key makes a second attempt fail as a whole, which is
 * reported as `skipped`.
 */
export class ReminderService {
  constructor(
    private readonly db: Database,
    private readonly queue: Queue,
    private readonly logger: Logger,
    private readonly clock: () => number = Date.now,
  ) {}

  async sendOnce(reminder: Reminder): Promise<ReminderOutcome> {
    if (reminder.key.length > REMINDER_KEY_MAX) throw new Error('Reminder key too long');
    if (await this.alreadySent(reminder.key)) return 'skipped';
    try {
      await new UnitOfWork(this.db)
        .add(
          this.db.insert(reminderLog).values({
            id: generateId(),
            key: reminder.key,
            companyId: reminder.companyId,
            template: reminder.template,
            sentAt: new Date(this.clock()),
          }),
          ...reminder.emails.map((email) => email.statement),
          ...(reminder.statements ?? []),
        )
        .commit();
    } catch (error) {
      // A concurrent run inserted the key first: nothing was written by this one.
      if (await this.alreadySent(reminder.key)) return 'skipped';
      throw error;
    }
    const jobs: JobMessage[] = reminder.emails.map((email) => email.job);
    await publishJobs(this.queue, jobs, this.logger);
    return 'sent';
  }

  private async alreadySent(key: string): Promise<boolean> {
    const row = await this.db
      .select({ id: reminderLog.id })
      .from(reminderLog)
      .where(eq(reminderLog.key, key))
      .get();
    return row !== undefined;
  }
}
