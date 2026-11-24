import { z } from 'zod';

import type { Logger } from '../../core/logging/logger';

/** Messages on the JOBS queue. One variant per background job type. */
export const jobMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email.send'),
    outboxId: z.string(),
    // Secret values for links (T-10). They exist only in the queue message.
    secrets: z.record(z.string(), z.string()).optional(),
  }),
]);
export type JobMessage = z.infer<typeof jobMessageSchema>;

/**
 * Publishes jobs after the database batch that created them has committed. A failed publish
 * is logged, not thrown: the change is already saved, and PLT-05 FR-5 recovers the email.
 */
export async function publishJobs(queue: Queue, jobs: JobMessage[], logger: Logger): Promise<void> {
  if (jobs.length === 0) return;
  try {
    await queue.sendBatch(jobs.map((body) => ({ body })));
  } catch (error) {
    logger.error('publishing jobs failed', { error, count: jobs.length });
  }
}
