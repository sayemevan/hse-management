import { ConfigurationError } from '../core/errors/app-error';
import type { LogLevel } from '../core/logging/logger';
import { type APP_ENVIRONMENTS, envSchema, type EnvVars } from './env.schema';

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/** Typed, validated application configuration. Services depend on this, never on raw env. */
export interface AppConfig {
  readonly environment: AppEnvironment;
  readonly logLevel: LogLevel;
  readonly cors: {
    readonly allowedOrigins: readonly string[];
  };
  readonly tenancy: {
    readonly baseDomain: string;
    readonly trustForwardedHost: boolean;
    readonly cacheTtlSeconds: number;
  };
  readonly auth: {
    readonly jwtSecret: string;
    readonly issuer: string;
    readonly audience: string;
    readonly accessTokenTtlSeconds: number;
  };
  readonly session: {
    readonly idleTimeoutSeconds: number;
    readonly absoluteLifetimeSeconds: number;
    readonly activityWriteIntervalSeconds: number;
    readonly refreshReuseGraceSeconds: number;
  };
  readonly security: {
    readonly passwordHashIterations: number;
    readonly maxFailedLoginAttempts: number;
    readonly lockDurationSeconds: number;
    /** Refresh cookies are `Secure` everywhere except plain-HTTP local development. */
    readonly secureCookies: boolean;
  };
  /** Public base-domain URL, e.g. https://example.com (no trailing slash). */
  readonly platformUrl: string;
  readonly email: {
    readonly provider: 'resend' | 'log';
    readonly from: string;
    readonly resendApiKey: string | null;
  };
  readonly botCheck: {
    readonly provider: 'turnstile' | 'disabled';
    readonly turnstileSecretKey: string | null;
  };
  readonly registration: {
    readonly trialDays: number;
    readonly verifyTokenTtlMs: number;
    readonly unverifiedRetentionMs: number;
    readonly resubmitTokenTtlMs: number;
    readonly resendLimitPerHour: number;
  };
  readonly accounts: {
    readonly invitationTtlMs: number;
    readonly passwordResetTtlMs: number;
    readonly passwordResetLimitPerHour: number;
  };
  readonly billing: {
    readonly graceMs: number;
    readonly pendingProofHoldMs: number;
    readonly bankDetails: {
      readonly bankName: string;
      readonly beneficiary: string;
      readonly iban: string;
    };
  };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Worker env objects are stable for the isolate's lifetime, so parse once per env object.
const cache = new WeakMap<object, AppConfig>();

/**
 * Validates the Worker env and returns the typed configuration.
 * Fails fast with a ConfigurationError that names every invalid key (never the values).
 */
export function loadConfig(env: EnvVars): AppConfig {
  const cached = cache.get(env);
  if (cached) return cached;

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new ConfigurationError(`Invalid configuration: ${keys.join(', ')}`);
  }

  const values = parsed.data;
  const isLocal = values.APP_ENV === 'development' || values.APP_ENV === 'test';
  if (values.TRUST_FORWARDED_HOST && values.APP_ENV === 'production') {
    throw new ConfigurationError('TRUST_FORWARDED_HOST must be false in production');
  }
  if (!isLocal && (values.EMAIL_PROVIDER === 'log' || values.BOT_CHECK === 'disabled')) {
    throw new ConfigurationError(
      'EMAIL_PROVIDER=log and BOT_CHECK=disabled are for local use only',
    );
  }
  if (values.EMAIL_PROVIDER === 'resend' && !values.RESEND_API_KEY) {
    throw new ConfigurationError('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
  }
  if (values.BOT_CHECK === 'turnstile' && !values.TURNSTILE_SECRET_KEY) {
    throw new ConfigurationError('TURNSTILE_SECRET_KEY is required when BOT_CHECK=turnstile');
  }

  const config: AppConfig = {
    environment: values.APP_ENV,
    logLevel: values.LOG_LEVEL,
    cors: { allowedOrigins: values.CORS_ALLOWED_ORIGINS },
    tenancy: {
      baseDomain: values.BASE_DOMAIN,
      trustForwardedHost: values.TRUST_FORWARDED_HOST,
      cacheTtlSeconds: values.TENANT_CACHE_TTL_SECONDS,
    },
    auth: {
      jwtSecret: values.JWT_SECRET,
      issuer: values.JWT_ISSUER,
      audience: values.JWT_AUDIENCE,
      accessTokenTtlSeconds: values.JWT_ACCESS_TOKEN_TTL_SECONDS,
    },
    session: {
      idleTimeoutSeconds: values.SESSION_IDLE_TIMEOUT_SECONDS,
      absoluteLifetimeSeconds: values.SESSION_ABSOLUTE_LIFETIME_SECONDS,
      activityWriteIntervalSeconds: values.SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS,
      refreshReuseGraceSeconds: values.REFRESH_REUSE_GRACE_SECONDS,
    },
    security: {
      passwordHashIterations: values.PASSWORD_HASH_ITERATIONS,
      maxFailedLoginAttempts: values.LOGIN_MAX_FAILED_ATTEMPTS,
      lockDurationSeconds: values.LOGIN_LOCK_DURATION_SECONDS,
      secureCookies: !isLocal,
    },
    platformUrl: values.PLATFORM_URL.replace(/\/+$/, ''),
    email: {
      provider: values.EMAIL_PROVIDER,
      from: values.EMAIL_FROM,
      resendApiKey: values.RESEND_API_KEY ?? null,
    },
    botCheck: {
      provider: values.BOT_CHECK,
      turnstileSecretKey: values.TURNSTILE_SECRET_KEY ?? null,
    },
    registration: {
      trialDays: values.TRIAL_DAYS,
      verifyTokenTtlMs: values.REGISTRATION_VERIFY_TTL_HOURS * HOUR_MS,
      unverifiedRetentionMs: values.REGISTRATION_UNVERIFIED_RETENTION_DAYS * DAY_MS,
      resubmitTokenTtlMs: values.REGISTRATION_RESUBMIT_TTL_DAYS * DAY_MS,
      resendLimitPerHour: values.REGISTRATION_RESEND_LIMIT_PER_HOUR,
    },
    accounts: {
      invitationTtlMs: values.INVITATION_TTL_DAYS * DAY_MS,
      passwordResetTtlMs: values.PASSWORD_RESET_TTL_MINUTES * 60_000,
      passwordResetLimitPerHour: values.PASSWORD_RESET_LIMIT_PER_HOUR,
    },
    billing: {
      graceMs: values.GRACE_DAYS * DAY_MS,
      pendingProofHoldMs: values.PENDING_PROOF_HOLD_DAYS * DAY_MS,
      bankDetails: {
        bankName: values.BILLING_BANK_NAME,
        beneficiary: values.BILLING_BENEFICIARY,
        iban: values.BILLING_IBAN,
      },
    },
  };

  cache.set(env, config);
  return config;
}
