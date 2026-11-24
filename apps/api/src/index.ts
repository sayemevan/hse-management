import { createApp } from './app';
import { type AppConfig, loadConfig } from './config/config';
import type { Bindings } from './core/context/app-context';
import { Logger } from './core/logging/logger';
import { createDatabase } from './database/client';
import { dailyJobs } from './jobs';
import {
  collectStuckEmails,
  type EmailSender,
  LogEmailSender,
  processEmailJob,
  ResendEmailSender,
} from './platform/email';
import { jobMessageSchema, publishJobs } from './platform/jobs';

const app = createApp();

/** Daily at 03:00 UTC (wrangler.jsonc). Every other cron is the 15-minute email recovery. */
const DAILY_CRON = '0 3 * * *';

function emailSenderFor(config: AppConfig, logger: Logger): EmailSender {
  return config.email.provider === 'resend' && config.email.resendApiKey
    ? new ResendEmailSender(config.email.resendApiKey)
    : new LogEmailSender(logger);
}

/**
 * Worker entry point.
 * - `fetch`: the HTTP API.
 * - `queue`: background jobs from JOBS (PLT-05 email sending).
 * - `scheduled`: the daily jobs (PLT-09: housekeeping, subscription lifecycle) and the
 *   15-minute email recovery.
 */
export default {
  fetch: app.fetch,

  async queue(batch, env) {
    const config = loadConfig(env);
    const logger = new Logger(config.logLevel, { service: 'hse-api', job: 'queue' });
    const db = createDatabase(env.DB);
    const sender = emailSenderFor(config, logger);

    for (const message of batch.messages) {
      const parsed = jobMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        logger.error('dropping malformed job message', { id: message.id });
        message.ack();
        continue;
      }
      try {
        const outcome = await processEmailJob(
          { db, sender, from: config.email.from, logger },
          parsed.data,
        );
        if (outcome.kind === 'retry') message.retry({ delaySeconds: outcome.delaySeconds });
        else message.ack();
      } catch (error) {
        // Unexpected failure (e.g. database unavailable): let the queue retry it.
        logger.error('job failed unexpectedly', { error, id: message.id });
        message.retry();
      }
    }
  },

  async scheduled(controller, env) {
    const config = loadConfig(env);
    const logger = new Logger(config.logLevel, { service: 'hse-api', cron: controller.cron });
    const db = createDatabase(env.DB);

    if (controller.cron !== DAILY_CRON) {
      await publishJobs(env.JOBS, await collectStuckEmails(db), logger);
      return;
    }

    await dailyJobs.runAll({
      db,
      env,
      config,
      logger,
      clock: Date.now,
      runId: `cron-${String(controller.scheduledTime)}`,
    });
  },
} satisfies ExportedHandler<Bindings>;
