import { type ApiFailure, type ApiSuccess, ErrorCode } from '@hse/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../src/app';
import { authenticate } from '../src/core/auth/authenticate.middleware';
import { denyAllPermissionChecker, requirePermission } from '../src/core/auth/authorization';
import { TokenService } from '../src/core/auth/token-service';
import type { AppEnv } from '../src/core/context/app-context';
import { errorHandler, notFoundHandler } from '../src/core/errors/error-handler';
import { ok } from '../src/core/http/response';
import { validate } from '../src/core/http/validation';
import { requestContext } from '../src/core/middleware/request-context.middleware';
import { requestId } from '../src/core/middleware/request-id.middleware';
import { testEnv } from './helpers';

describe('API foundation', () => {
  it('serves the health check in the success envelope with a request id', async () => {
    const response = await createApp().request('/api/v1/health', {}, testEnv());
    const body: ApiSuccess<{ status: string; environment: string }> = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(body).toMatchObject({
      success: true,
      message: 'OK',
      data: { status: 'ok', environment: 'test' },
    });
  });

  it('keeps a safe caller-supplied request id', async () => {
    const response = await createApp().request(
      '/api/v1/health',
      { headers: { 'x-request-id': 'trace-12345678' } },
      testEnv(),
    );
    expect(response.headers.get('x-request-id')).toBe('trace-12345678');
  });

  it('answers unknown routes with the error envelope', async () => {
    const response = await createApp().request('/api/v1/unknown', {}, testEnv());
    const body: ApiFailure = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
    expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('hides configuration problems behind a generic 500', async () => {
    const response = await createApp().request(
      '/api/v1/health',
      {},
      testEnv({ JWT_SECRET: 'short' }),
    );
    const body: ApiFailure = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(JSON.stringify(body)).not.toContain('JWT_SECRET');
  });

  it('sets security headers and honours the CORS allow-list', async () => {
    const app = createApp();
    const allowed = await app.request(
      '/api/v1/health',
      { headers: { origin: 'http://localhost:3000' } },
      testEnv(),
    );
    const denied = await app.request(
      '/api/v1/health',
      { headers: { origin: 'https://evil.example' } },
      testEnv(),
    );

    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    expect(allowed.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('request validation', () => {
  const app = new Hono<AppEnv>()
    .use(requestId())
    .use(requestContext())
    .post('/items', validate('json', z.object({ title: z.string().min(1) })), (c) =>
      ok(c, c.req.valid('json')),
    )
    .notFound(notFoundHandler)
    .onError(errorHandler);

  it('returns 422 with field-level details', async () => {
    const response = await app.request(
      '/items',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      },
      testEnv(),
    );
    const body: ApiFailure = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(body.error.details?.[0]?.path).toBe('title');
  });
});

describe('authentication and authorization guards', () => {
  const env = testEnv();
  const app = new Hono<AppEnv>()
    .use(requestId())
    .use(requestContext())
    // Token-only check here; the real session validator is covered by the integration tests.
    .use(authenticate(() => Promise.resolve()))
    .get('/me', (c) => ok(c, c.get('principal')))
    .get(
      '/guarded',
      requirePermission(denyAllPermissionChecker, 'inspection.approve', () => ({
        level: 'platform',
      })),
      (c) => ok(c, null),
    )
    .onError(errorHandler);

  const tokens = new TokenService({
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    accessTokenTtlSeconds: 900,
  });

  it('rejects requests without a bearer token', async () => {
    const response = await app.request('/me', {}, env);
    expect(response.status).toBe(401);
  });

  it('accepts a valid token and exposes the principal', async () => {
    const { token } = await tokens.issueAccessToken({ userId: 'user-1', sessionId: 'session-1' });
    const response = await app.request(
      '/me',
      { headers: { authorization: `Bearer ${token}` } },
      env,
    );
    const body: ApiSuccess<{ userId: string }> = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.userId).toBe('user-1');
  });

  it('denies by default when no permission is granted', async () => {
    const { token } = await tokens.issueAccessToken({ userId: 'user-1', sessionId: 'session-1' });
    const response = await app.request(
      '/guarded',
      { headers: { authorization: `Bearer ${token}` } },
      env,
    );
    expect(response.status).toBe(403);
  });
});
