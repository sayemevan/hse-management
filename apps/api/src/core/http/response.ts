import type { ApiSuccess, ResponseMeta } from '@hse/shared';
import type { Context } from 'hono';

const DEFAULT_MESSAGE = 'OK';

interface SuccessOptions {
  message?: string;
  meta?: ResponseMeta;
}

function envelope<TData>(data: TData, options: SuccessOptions): ApiSuccess<TData> {
  return {
    success: true,
    message: options.message ?? DEFAULT_MESSAGE,
    data,
    ...(options.meta ? { meta: options.meta } : {}),
  };
}

/** 200 with the standard success envelope (API Rules: success, message, data, meta). */
export function ok<TData>(c: Context, data: TData, options: SuccessOptions = {}) {
  return c.json(envelope(data, options), 200);
}

/** 201 for a created resource. */
export function created<TData>(c: Context, data: TData, options: SuccessOptions = {}) {
  return c.json(envelope(data, { message: 'Created', ...options }), 201);
}

/** 202 when work was accepted but its outcome is not revealed (e.g. "check your email"). */
export function accepted<TData>(c: Context, data: TData, options: SuccessOptions = {}) {
  return c.json(envelope(data, { message: 'Accepted', ...options }), 202);
}
