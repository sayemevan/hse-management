import { type ApiFailure, ErrorCode, type ValidationIssue } from '@hse/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { AppEnv } from '../context/app-context';
import { Logger } from '../logging/logger';
import { AppError } from './app-error';

const GENERIC_MESSAGE = 'Something went wrong on our side. Please try again later.';
const NOT_FOUND_MESSAGE = 'The requested resource was not found.';

// Used only when a failure happens before the request logger exists
// (for example, invalid configuration).
const fallbackLogger = new Logger('info', { component: 'error-handler' });

function failure(
  c: Context<AppEnv>,
  code: ErrorCode,
  message: string,
  details?: ValidationIssue[],
  params?: Record<string, string | number>,
): ApiFailure {
  const requestId = c.get('requestId') as string | undefined;
  return {
    success: false,
    message,
    error: {
      code,
      ...(requestId ? { requestId } : {}),
      ...(details?.length ? { details } : {}),
      ...(params ? { params } : {}),
    },
  };
}

/**
 * Global error handler. Expected errors become their envelope; anything else is logged
 * in full and answered with a generic message (Master Rules §10: never expose technical
 * errors to end users).
 */
export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  const logger = (c.get('logger') as Logger | undefined) ?? fallbackLogger;

  if (error instanceof AppError) {
    if (error.status >= 500) logger.error(error.message, { error });
    else logger.info('request rejected', { code: error.code, status: error.status });
    return c.json(failure(c, error.code, error.message, error.details, error.params), error.status);
  }

  if (error instanceof HTTPException && error.status < 500) {
    logger.info('request rejected', { status: error.status });
    const code = error.status === 401 ? ErrorCode.UNAUTHENTICATED : ErrorCode.BAD_REQUEST;
    return c.json(failure(c, code, 'The request could not be processed.'), error.status);
  }

  logger.error('unhandled error', { error });
  return c.json(failure(c, ErrorCode.INTERNAL_ERROR, GENERIC_MESSAGE), 500);
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(failure(c, ErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE), 404);
