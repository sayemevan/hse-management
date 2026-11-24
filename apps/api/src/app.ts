import { Hono } from 'hono';

import type { AppEnv } from './core/context/app-context';
import { errorHandler, notFoundHandler } from './core/errors/error-handler';
import { requestContext } from './core/middleware/request-context.middleware';
import { requestId } from './core/middleware/request-id.middleware';
import { requestLogger } from './core/middleware/request-logger.middleware';
import { corsPolicy, securityHeaders } from './core/middleware/security.middleware';
import { API_V1_BASE_PATH, v1Routes } from './routes';

/**
 * Composes the API. Middleware order matters:
 * request id → config + logger → request log → security headers → CORS → routes.
 */
export function createApp() {
  return new Hono<AppEnv>()
    .use(requestId())
    .use(requestContext())
    .use(requestLogger())
    .use(securityHeaders())
    .use(corsPolicy())
    .route(API_V1_BASE_PATH, v1Routes)
    .notFound(notFoundHandler)
    .onError(errorHandler);
}

export type App = ReturnType<typeof createApp>;
