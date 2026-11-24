import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';

import type { AppEnv } from '../context/app-context';
import { REQUEST_ID_HEADER } from './request-id.middleware';

const CORS_MAX_AGE_SECONDS = 600;

/** Standard security headers (Doc 02 §11: XSS protection, secure API access). */
export const securityHeaders = () =>
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    crossOriginResourcePolicy: 'same-site',
    referrerPolicy: 'no-referrer',
  });

/**
 * CORS restricted to the configured web origins. The API uses bearer tokens, not cookies,
 * so credentials are not enabled (CSRF does not apply; Doc 02 §11 "where applicable").
 */
export const corsPolicy = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const { allowedOrigins } = c.get('config').cors;
    const handler = cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', REQUEST_ID_HEADER],
      exposeHeaders: [REQUEST_ID_HEADER],
      maxAge: CORS_MAX_AGE_SECONDS,
    });
    return handler(c, next);
  });
