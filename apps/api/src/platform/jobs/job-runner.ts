import type { JobRunDto } from '@hse/shared';
import { desc, eq, lt } from 'drizzle-orm';
import { generateId } from '@hse/shared';

import type { AppConfig } from '../../config/config';
import type { Bindings } from '../../core/context/app-context';
import type { Logger } from '../../core/logging/logger';
import type { Database } from '../../database/client';
import { jobRun, type JobRunRow } from './jobs.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
/** PLT-09 FR-3: job history kept this long. */
export const JOB_RUN_RETENTION_MS = 90 * DAY_MS;
const MAX_ERROR_LENGTH = 500;

/** What every scheduled job receives (PLT-09, T-25). */
export interface JobContext {
  db: Database;
  env: Bindings;
  config: AppConfig;
  logger: Logger;
  /** The job's clock; a development run may set it (`--now`, FR-6). */
  clock: () => number;
  /** Request-like id for audit entries written by the job. */
  runId: string;
}

export interface JobResult {
  processed: number;
  changed: number;
  failed: number;
}

export interface ScheduledJob {
  readonly name: string;
  run(context: JobContext): Promise<JobResult>;
}

export const NO_WORK: JobResult = { processed: 0, changed: 0, failed: 0 };

/**
 * Runs daily jobs in order (FR-2). Each job runs on its own: a failure is logged and recorded,
 * and the next job still runs. Every run is recorded in `job_run`.
 */
export class JobRunner {
  private readonly byName = new Map<string, ScheduledJob>();

  constructor(jobs: readonly ScheduledJob[]) {
    for (const job of jobs) {
      if (this.byName.has(job.name)) throw new Error(`Duplicate job name: ${job.name}`);
      this.byName.set(job.name, job);
    }
  }

  get names(): string[] {
    return [...this.byName.keys()];
  }

  async runAll(context: JobContext): Promise<JobRunRow[]> {
    const rows: JobRunRow[] = [];
    for (const job of this.byName.values()) rows.push(await this.execute(job, context));
    await this.purgeHistory(context);
    return rows;
  }

  async runOne(name: string, context: JobContext): Promise<JobRunRow> {
    const job = this.byName.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    return this.execute(job, context);
  }

  private async execute(job: ScheduledJob, context: JobContext): Promise<JobRunRow> {
    const logger = context.logger.child({ job: job.name });
    // History uses wall time even when the job runs with a chosen clock (FR-6), so a
    // simulated run never looks like the latest real one.
    const startedAt = Date.now();
    let result: JobResult = NO_WORK;
    let error: string | null = null;
    try {
      result = await job.run({ ...context, logger });
    } catch (cause) {
      error = (cause instanceof Error ? cause.message : String(cause)).slice(0, MAX_ERROR_LENGTH);
      logger.error('scheduled job failed', { error: cause });
    }
    const row: JobRunRow = {
      id: generateId(),
      jobName: job.name,
      startedAt: new Date(startedAt),
      finishedAt: new Date(Date.now()),
      outcome: error === null ? 'succeeded' : 'failed',
      ...result,
      error,
    };
    try {
      await context.db.insert(jobRun).values(row).run();
    } catch (cause) {
      logger.error('recording the job run failed', { error: cause });
    }
    logger.info('scheduled job finished', {
      outcome: row.outcome,
      processed: row.processed,
      changed: row.changed,
      failed: row.failed,
    });
    return row;
  }

  private async purgeHistory(context: JobContext): Promise<void> {
    try {
      await context.db
        .delete(jobRun)
        .where(lt(jobRun.startedAt, new Date(Date.now() - JOB_RUN_RETENTION_MS)))
        .run();
    } catch (cause) {
      context.logger.warn('job history purge failed', { error: cause });
    }
  }
}

/** FR-7: the last run of each registered job, for the System Owner. */
export async function latestJobRuns(db: Database, names: readonly string[]): Promise<JobRunDto[]> {
  return Promise.all(
    names.map(async (name) => {
      const row = await db
        .select()
        .from(jobRun)
        .where(eq(jobRun.jobName, name))
        .orderBy(desc(jobRun.startedAt))
        .limit(1)
        .get();
      return {
        name,
        lastRunAt: row?.startedAt.getTime() ?? null,
        outcome: row?.outcome ?? null,
        processed: row?.processed ?? 0,
        changed: row?.changed ?? 0,
        failed: row?.failed ?? 0,
        error: row?.error ?? null,
      };
    }),
  );
}
