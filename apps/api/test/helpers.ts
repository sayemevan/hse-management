import type { EnvVars } from '../src/config/env.schema';
import type { Bindings } from '../src/core/context/app-context';

/** Worker variables for tests. Lower hashing cost keeps tests fast; everything else matches dev. */
export const TEST_VARS: EnvVars = {
  APP_ENV: 'test',
  LOG_LEVEL: 'error',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  BASE_DOMAIN: 'localhost',
  TRUST_FORWARDED_HOST: 'true',
  TENANT_CACHE_TTL_SECONDS: '300',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing',
  JWT_ISSUER: 'hse-api',
  JWT_AUDIENCE: 'hse-web',
  JWT_ACCESS_TOKEN_TTL_SECONDS: '900',
  SESSION_IDLE_TIMEOUT_SECONDS: '28800',
  SESSION_ABSOLUTE_LIFETIME_SECONDS: '2592000',
  SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS: '300',
  REFRESH_REUSE_GRACE_SECONDS: '30',
  LOGIN_MAX_FAILED_ATTEMPTS: '5',
  LOGIN_LOCK_DURATION_SECONDS: '900',
  PASSWORD_HASH_ITERATIONS: '10000',
  PLATFORM_URL: 'http://localhost:3000',
  EMAIL_PROVIDER: 'log',
  EMAIL_FROM: 'HSE Platform <no-reply@localhost>',
  BOT_CHECK: 'disabled',
  TRIAL_DAYS: '14',
  REGISTRATION_VERIFY_TTL_HOURS: '24',
  REGISTRATION_UNVERIFIED_RETENTION_DAYS: '7',
  REGISTRATION_RESUBMIT_TTL_DAYS: '30',
  REGISTRATION_RESEND_LIMIT_PER_HOUR: '3',
  INVITATION_TTL_DAYS: '7',
  PASSWORD_RESET_TTL_MINUTES: '60',
  PASSWORD_RESET_LIMIT_PER_HOUR: '3',
  GRACE_DAYS: '14',
  PENDING_PROOF_HOLD_DAYS: '5',
  BILLING_BANK_NAME: 'Test Bank',
  BILLING_BENEFICIARY: 'HSE Platform',
  BILLING_IBAN: 'SA0380000000608010167519',
};

export const allowAllRateLimiter: RateLimit = {
  limit: () => Promise.resolve({ success: true }),
};

/** Env for unit tests that never touch Cloudflare bindings. */
export function testEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ...TEST_VARS,
    DB: {} as D1Database,
    FILES: {} as R2Bucket,
    CACHE: {} as KVNamespace,
    JOBS: {} as Queue,
    AUTH_RATE_LIMITER: allowAllRateLimiter,
    ...overrides,
  };
}
