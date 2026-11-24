import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPlatformProxy } from 'wrangler';

import type { Bindings } from '../../src/core/context/app-context';
import { allowAllRateLimiter, TEST_VARS } from '../helpers';
import { CapturingQueue, Mailbox } from './mailbox';

const API_ROOT = join(import.meta.dirname, '..', '..');
const MIGRATIONS_DIR = join(API_ROOT, 'migrations');

export interface IntegrationEnv {
  env: Bindings;
  /** Jobs published by the API; run them with `mailbox.deliver()`. */
  jobs: CapturingQueue;
  mailbox: Mailbox;
  dispose: () => Promise<void>;
}

/**
 * Starts the real local Workers runtime bindings (D1, KV, R2, Queues) in memory and applies
 * every migration, exactly as `wrangler d1 migrations apply` would.
 */
export async function startIntegrationEnv(): Promise<IntegrationEnv> {
  const proxy = await getPlatformProxy<Bindings>({
    configPath: join(API_ROOT, 'wrangler.jsonc'),
    persist: false,
    envFiles: [],
  });
  await applyMigrations(proxy.env.DB);

  const jobs = new CapturingQueue();
  const env: Bindings = {
    ...proxy.env,
    ...TEST_VARS,
    AUTH_RATE_LIMITER: allowAllRateLimiter,
    JOBS: jobs.asQueue(),
  };
  return { env, jobs, mailbox: new Mailbox(env, jobs), dispose: () => proxy.dispose() };
}

async function applyMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const statements = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  }
}
