/**
 * Runs one daily job against the LOCAL development database (PLT-09 FR-6):
 *   npm run job:run --workspace @hse/api -- <job-name> [--now 2026-12-01T06:00:00Z]
 *   npm run job:run --workspace @hse/api -- --list
 *
 * `--now` runs the job as if it were that time, to try trial expiry, grace and reminders
 * without waiting. Emails the job queues are "sent" with the log sender and printed here.
 * Local only: the bindings come from `.wrangler/state`, the same data `npm run dev` uses.
 */
import { join } from 'node:path';

import { getPlatformProxy } from 'wrangler';

import { loadConfig } from '../src/config/config';
import type { Bindings } from '../src/core/context/app-context';
import { Logger } from '../src/core/logging/logger';
import { createDatabase } from '../src/database/client';
import { dailyJobs } from '../src/jobs';
import { LogEmailSender, processEmailJob } from '../src/platform/email';
import { type JobMessage, jobMessageSchema } from '../src/platform/jobs';

function parseArgs(argv: string[]): {
  name: string | undefined;
  now: number | null;
  list: boolean;
} {
  const nowIndex = argv.indexOf('--now');
  const nowValue = nowIndex === -1 ? undefined : argv[nowIndex + 1];
  const now = nowValue === undefined ? null : Date.parse(nowValue);
  if (now !== null && Number.isNaN(now))
    throw new Error(`--now is not a date: ${String(nowValue)}`);
  const name = argv.find((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--now');
  return { name, now, list: argv.includes('--list') };
}

async function main(): Promise<void> {
  const { name, now, list } = parseArgs(process.argv.slice(2));
  if (list || !name) {
    console.log(`Daily jobs: ${dailyJobs.names.join(', ')}`);
    if (!name) process.exitCode = list ? 0 : 1;
    return;
  }

  const proxy = await getPlatformProxy<Bindings>({
    configPath: join(import.meta.dirname, '..', 'wrangler.jsonc'),
    persist: true,
  });
  try {
    const captured: JobMessage[] = [];
    const queue = {
      send: (body: unknown) => {
        captured.push(jobMessageSchema.parse(body));
        return Promise.resolve();
      },
      sendBatch: (messages: Iterable<{ body: unknown }>) => {
        for (const message of messages) captured.push(jobMessageSchema.parse(message.body));
        return Promise.resolve();
      },
    } as unknown as Queue;
    const env: Bindings = { ...proxy.env, JOBS: queue };
    const config = loadConfig(env);
    if (now !== null && !['development', 'test'].includes(config.environment)) {
      throw new Error('--now is only allowed in development and test');
    }
    const logger = new Logger(config.logLevel, { service: 'hse-api', script: 'run-job' });
    const db = createDatabase(env.DB);
    const clock = now === null ? Date.now : () => now;

    const row = await dailyJobs.runOne(name, {
      db,
      env,
      config,
      logger,
      clock,
      runId: `script-${String(Date.now())}`,
    });
    console.log(
      `${row.jobName}: ${row.outcome} — processed ${String(row.processed)}, changed ${String(row.changed)}, failed ${String(row.failed)}${row.error ? ` (${row.error})` : ''}`,
    );

    // Deliver what the job queued, so the emails show up in this terminal.
    const sender = new LogEmailSender(new Logger('info', { script: 'run-job' }));
    for (const job of captured) {
      await processEmailJob({ db, sender, from: config.email.from, logger }, job);
    }
    if (captured.length > 0)
      console.log(`${String(captured.length)} email(s) delivered to the log.`);
  } finally {
    await proxy.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
