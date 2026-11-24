import { Hono } from 'hono';

import type { AppEnv } from '../../core/context/app-context';
import { requestLanguage } from '../../core/http/request-language';
import { ok } from '../../core/http/response';
import { createDatabase } from '../../database/client';
import { SubscriptionService, toPlanDto } from './subscription.service';

/** `GET /plans` — public plan catalogue for the registration form (PLT-06). */
export const planRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const plans = await new SubscriptionService(createDatabase(c.env.DB)).listActivePlans();
  const language = requestLanguage(c);
  return ok(
    c,
    plans.map((row) => toPlanDto(row, language)),
  );
});
