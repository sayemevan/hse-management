import {
  type ApiFailure,
  type ApiSuccess,
  ErrorCode,
  isApiFailure,
  type ValidationIssue,
} from '@hse/shared';

import { publicEnv } from '@/config/public-env';

const NETWORK_ERROR_MESSAGE = 'We could not reach the server. Check your connection and try again.';
const UNEXPECTED_RESPONSE_MESSAGE = 'Something went wrong. Please try again later.';

/** A failed API call. Show it with `useErrorMessage()`, which translates `code` (PLT-03). */
export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly details: ValidationIssue[] = [],
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  static fromFailure(failure: ApiFailure, status: number): ApiClientError {
    return new ApiClientError(
      failure.error.code,
      failure.message,
      status,
      failure.error.requestId,
      failure.error.details,
      failure.error.params,
    );
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
  signal?: AbortSignal;
}

/**
 * The single HTTP entry point for the web app. UI components call module services, which
 * call this; components never call `fetch` directly (business logic stays out of the UI).
 * Requests are same-origin (T-4), so the refresh cookie is sent automatically.
 */
export async function apiRequest<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiSuccess<TData>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  // FormData (file uploads, PLT-07) sets its own multipart content type.
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body:
        options.body === undefined
          ? null
          : isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body),
      signal: options.signal ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(ErrorCode.SERVICE_UNAVAILABLE, NETWORK_ERROR_MESSAGE, 0);
  }

  // 204 No Content (e.g. cancel an invitation, remove the logo).
  if (response.status === 204) return { success: true, message: '', data: null as TData };

  const payload: unknown = await response.json().catch(() => null);

  if (isApiFailure(payload)) throw ApiClientError.fromFailure(payload, response.status);
  if (!response.ok || !isApiSuccess<TData>(payload)) {
    throw new ApiClientError(
      ErrorCode.INTERNAL_ERROR,
      UNEXPECTED_RESPONSE_MESSAGE,
      response.status,
      response.headers.get('x-request-id') ?? undefined,
    );
  }
  return payload;
}

function isApiSuccess<TData>(value: unknown): value is ApiSuccess<TData> {
  return (
    typeof value === 'object' && value !== null && (value as { success?: unknown }).success === true
  );
}

/**
 * A file download (e.g. a payment receipt, PLT-14). Same rules as `apiRequest`, but the
 * successful body is returned as a Blob; failures still use the error envelope.
 */
export async function apiBlob(path: string, accessToken: string | null): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiClientError(ErrorCode.SERVICE_UNAVAILABLE, NETWORK_ERROR_MESSAGE, 0);
  }
  if (response.ok) return response.blob();
  const payload: unknown = await response.json().catch(() => null);
  if (isApiFailure(payload)) throw ApiClientError.fromFailure(payload, response.status);
  throw new ApiClientError(ErrorCode.INTERNAL_ERROR, UNEXPECTED_RESPONSE_MESSAGE, response.status);
}
