import { z } from 'zod';

import { LOG_LEVELS } from '../core/logging/logger';

/**
 * Schema for the Worker's string variables and secrets.
 * Every configurable value is declared here; nothing is hard-coded in services
 * (Master Configuration Guide: "values should be configurable instead of hard-coded").
 */
export const APP_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;

const positiveInt = z.coerce.number().int().positive();

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

const commaSeparatedOrigins = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.url()));

// A bare host name such as `localhost` or `hseplatform.com` (no scheme, port or path).
const hostName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/, 'invalid host name');

export const envSchema = z.object({
  APP_ENV: z.enum(APP_ENVIRONMENTS),
  LOG_LEVEL: z.enum(LOG_LEVELS),
  CORS_ALLOWED_ORIGINS: commaSeparatedOrigins,

  // Tenancy (PLT-02)
  BASE_DOMAIN: hostName,
  // Only true where a trusted proxy (local Next.js dev server) sets x-forwarded-host.
  TRUST_FORWARDED_HOST: booleanFlag,
  TENANT_CACHE_TTL_SECONDS: positiveInt.min(60).max(3_600),

  // Tokens (T-1)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_ACCESS_TOKEN_TTL_SECONDS: positiveInt.max(86_400),

  // Sessions (D-04, T-3)
  SESSION_IDLE_TIMEOUT_SECONDS: positiveInt,
  SESSION_ABSOLUTE_LIFETIME_SECONDS: positiveInt,
  SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS: positiveInt,
  // Window in which a just-rotated refresh token is still accepted (parallel tabs).
  REFRESH_REUSE_GRACE_SECONDS: positiveInt.max(120),

  // Login protection (D-05)
  LOGIN_MAX_FAILED_ATTEMPTS: positiveInt.max(100),
  LOGIN_LOCK_DURATION_SECONDS: positiveInt,

  // Cloudflare Workers caps PBKDF2 at 100,000 iterations (ADR-001).
  PASSWORD_HASH_ITERATIONS: positiveInt.min(10_000).max(100_000),

  // Public address of the platform (base domain) used in email links, e.g. https://example.com
  PLATFORM_URL: z.url(),

  // Email (PLT-05, ADR-002). "log" writes emails to the log instead of sending them.
  EMAIL_PROVIDER: z.enum(['resend', 'log']),
  EMAIL_FROM: z.string().min(3),
  RESEND_API_KEY: z.string().min(1).optional(),

  // Bot protection (T-11). "disabled" is allowed only in development and tests.
  BOT_CHECK: z.enum(['turnstile', 'disabled']),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),

  // Registration (US-011.1 – US-011.5, PLT-06)
  TRIAL_DAYS: positiveInt.max(365),
  REGISTRATION_VERIFY_TTL_HOURS: positiveInt.max(168),
  REGISTRATION_UNVERIFIED_RETENTION_DAYS: positiveInt.max(90),
  REGISTRATION_RESUBMIT_TTL_DAYS: positiveInt.max(365),
  REGISTRATION_RESEND_LIMIT_PER_HOUR: positiveInt.max(20),

  // Invitations and password reset (US-006, US-002, US-003; O-21, O-22)
  INVITATION_TTL_DAYS: positiveInt.max(30),
  PASSWORD_RESET_TTL_MINUTES: positiveInt.max(1440),
  PASSWORD_RESET_LIMIT_PER_HOUR: positiveInt.max(20),

  // Subscription lifecycle (PLT-10, D-18, O-32) and bank details for transfers (O-37, F-09)
  GRACE_DAYS: positiveInt.max(90),
  PENDING_PROOF_HOLD_DAYS: positiveInt.max(30),
  BILLING_BANK_NAME: z.string().trim().min(1),
  BILLING_BENEFICIARY: z.string().trim().min(1),
  BILLING_IBAN: z.string().trim().min(1),
});

/** Raw string values as Wrangler provides them. */
export interface EnvVars {
  APP_ENV: string;
  LOG_LEVEL: string;
  CORS_ALLOWED_ORIGINS: string;
  BASE_DOMAIN: string;
  TRUST_FORWARDED_HOST: string;
  TENANT_CACHE_TTL_SECONDS: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  JWT_ACCESS_TOKEN_TTL_SECONDS: string;
  SESSION_IDLE_TIMEOUT_SECONDS: string;
  SESSION_ABSOLUTE_LIFETIME_SECONDS: string;
  SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS: string;
  REFRESH_REUSE_GRACE_SECONDS: string;
  LOGIN_MAX_FAILED_ATTEMPTS: string;
  LOGIN_LOCK_DURATION_SECONDS: string;
  PASSWORD_HASH_ITERATIONS: string;
  PLATFORM_URL: string;
  EMAIL_PROVIDER: string;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
  BOT_CHECK: string;
  TURNSTILE_SECRET_KEY?: string;
  TRIAL_DAYS: string;
  REGISTRATION_VERIFY_TTL_HOURS: string;
  REGISTRATION_UNVERIFIED_RETENTION_DAYS: string;
  REGISTRATION_RESUBMIT_TTL_DAYS: string;
  REGISTRATION_RESEND_LIMIT_PER_HOUR: string;
  INVITATION_TTL_DAYS: string;
  PASSWORD_RESET_TTL_MINUTES: string;
  PASSWORD_RESET_LIMIT_PER_HOUR: string;
  GRACE_DAYS: string;
  PENDING_PROOF_HOLD_DAYS: string;
  BILLING_BANK_NAME: string;
  BILLING_BENEFICIARY: string;
  BILLING_IBAN: string;
}
