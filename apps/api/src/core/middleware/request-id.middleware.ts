import { generateId } from '@hse/shared';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../context/app-context';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept caller-supplied ids only if they are short and contain safe characters,
// so they cannot inject content into logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** Assigns every request a traceable id and echoes it in the response headers. */
export const requestId = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : generateId();
    c.set('requestId', id);
    c.header(REQUEST_ID_HEADER, id);
    await next();
  });
