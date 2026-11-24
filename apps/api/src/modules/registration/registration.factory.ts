import type { Context } from 'hono';

import type { AppEnv } from '../../core/context/app-context';
import { requestMeta } from '../../core/http/request-meta';
import { createDatabase } from '../../database/client';
import { botCheckFor } from '../../platform/bot-check';
import { RegistrationContext } from './registration.context';
import { RegistrationReviewService } from './registration-review.service';
import { RegistrationService } from './registration.service';

export function registrationContextFor(c: Context<AppEnv>): RegistrationContext {
  const config = c.get('config');
  return new RegistrationContext({
    db: createDatabase(c.env.DB),
    config,
    meta: requestMeta(c),
    logger: c.get('logger'),
    queue: c.env.JOBS,
    cache: c.env.CACHE,
    botCheck: botCheckFor(config),
    clock: Date.now,
  });
}

export function registrationServicesFor(c: Context<AppEnv>) {
  const ctx = registrationContextFor(c);
  return { applicant: new RegistrationService(ctx), review: new RegistrationReviewService(ctx) };
}
