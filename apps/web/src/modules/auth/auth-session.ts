import { type AccessTokenDto, type ApiSuccess, ErrorCode } from '@hse/shared';

import { ApiClientError, apiBlob, apiRequest, type ApiRequestOptions } from '@/services/api-client';

/**
 * Holds the access token **in memory only** (T-1) and keeps it fresh.
 * The refresh token lives in an HttpOnly cookie that JavaScript cannot read.
 */
const EXPIRY_MARGIN_MS = 30_000;
const SESSION_ENDED_CODES: readonly ErrorCode[] = [
  ErrorCode.SESSION_EXPIRED,
  ErrorCode.UNAUTHENTICATED,
  ErrorCode.ACCOUNT_INACTIVE,
];

type Listener = () => void;

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let refreshInFlight: Promise<boolean> | null = null;
const sessionEndedListeners = new Set<Listener>();

export function setAccessToken(token: AccessTokenDto): void {
  accessToken = token.accessToken;
  accessTokenExpiresAt = token.accessTokenExpiresAt;
}

export function clearAccessToken(): void {
  accessToken = null;
  accessTokenExpiresAt = 0;
}

/** Called when the server says the session is over (expired, revoked or account suspended). */
export function onSessionEnded(listener: Listener): () => void {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

function isSessionEnded(error: unknown): boolean {
  return error instanceof ApiClientError && SESSION_ENDED_CODES.includes(error.code);
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request,
 * so parallel API calls never trigger parallel rotations. Resolves false when the session is over.
 */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= apiRequest<AccessTokenDto>('/auth/refresh', { method: 'POST' })
    .then((response) => {
      setAccessToken(response.data);
      return true;
    })
    .catch((error: unknown) => {
      clearAccessToken();
      if (isSessionEnded(error)) return false;
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * PLT-27 / PLT-28: a token for the sync engine without telling the screens the session ended
 * (the queue waits for sign-in instead). Network failures throw, as `refreshAccessToken`.
 */
export function syncAccessToken(): Promise<string | null> {
  return ensureAccessToken();
}

async function ensureAccessToken(): Promise<string | null> {
  if (accessToken && accessTokenExpiresAt - EXPIRY_MARGIN_MS > Date.now()) return accessToken;
  return (await refreshAccessToken()) ? accessToken : null;
}

/**
 * An authenticated API call. Retries once after refreshing if the server rejects the token;
 * if the session is really over, notifies listeners (the "session expired" screen, US-010).
 */
export async function authorizedRequest<TData>(
  path: string,
  options: Omit<ApiRequestOptions, 'accessToken'> = {},
): Promise<ApiSuccess<TData>> {
  const ended = (): never => {
    for (const listener of sessionEndedListeners) listener();
    throw new ApiClientError(ErrorCode.SESSION_EXPIRED, 'Your session has expired.', 401);
  };

  const token = await ensureAccessToken();
  if (!token) return ended();

  try {
    return await apiRequest<TData>(path, { ...options, accessToken: token });
  } catch (error) {
    if (!isSessionEnded(error)) throw error;
    if (!(await refreshAccessToken())) return ended();
    try {
      return await apiRequest<TData>(path, { ...options, accessToken });
    } catch (retryError) {
      if (isSessionEnded(retryError)) return ended();
      throw retryError;
    }
  }
}

/** An authenticated file download (PLT-14 receipt), refreshing the token once if needed. */
export async function authorizedBlob(path: string): Promise<Blob> {
  const token = await ensureAccessToken();
  try {
    return await apiBlob(path, token);
  } catch (error) {
    if (!isSessionEnded(error) || !(await refreshAccessToken())) throw error;
    return apiBlob(path, accessToken);
  }
}
