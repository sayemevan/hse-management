import { createMiddleware } from 'hono/factory';

import { loadConfig } from '../../config/config';
import type { AppEnv } from '../context/app-context';
import { Logger } from '../logging/logger';

/**
 * Loads the validated configuration and creates the request-scoped logger.
 * Must run right after `requestId()` so every later log line carries the request id.
 */
export const requestContext = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const config = loadConfig(c.env);
    c.set('config', config);
    c.set(
      'logger',
      new Logger(config.logLevel, {
        service: 'hse-api',
        environment: config.environment,
        requestId: c.get('requestId'),
      }),
    );
    await next();
  });
