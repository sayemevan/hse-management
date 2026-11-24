import type { TenantSubscriptionDto } from '@hse/shared';

import type { AppConfig } from '../../config/config';
import type { EnvVars } from '../../config/env.schema';
import type { Principal } from '../auth/principal';
import type { Logger } from '../logging/logger';
import type { TenantContext } from './tenant';

/** Cloudflare bindings declared in wrangler.jsonc, plus string vars and secrets. */
export type Bindings = EnvVars & {
  DB: D1Database;
  FILES: R2Bucket;
  CACHE: KVNamespace;
  JOBS: Queue;
  /** Per-IP limiter for sign-in and token refresh (T-7). */
  AUTH_RATE_LIMITER: RateLimit;
};

/** Per-request values set by middleware and read through `c.get(...)`. */
export interface Variables {
  requestId: string;
  config: AppConfig;
  logger: Logger;
  tenant: TenantContext;
  principal: Principal;
  /**
   * The company's subscription state, set by the billing module on company requests
   * (PLT-11). Absent on the base domain and before it is loaded.
   */
  tenantSubscription: TenantSubscriptionDto | undefined;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
