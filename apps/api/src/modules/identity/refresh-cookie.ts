import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { AppEnv } from '../../core/context/app-context';
import { API_V1_BASE_PATH } from '../../routes/paths';

export const REFRESH_COOKIE_NAME = 'hse_refresh';
// Sent only to the auth endpoints, never to the rest of the API.
const COOKIE_PATH = `${API_V1_BASE_PATH}/auth`;

/** The refresh token cookie (T-1): HttpOnly, SameSite=Strict, Secure outside local development. */
export function setRefreshCookie(c: Context<AppEnv>, token: string, expiresAt: number): void {
  setCookie(c, REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: c.get('config').security.secureCookies,
    sameSite: 'Strict',
    path: COOKIE_PATH,
    maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  });
}

export function readRefreshCookie(c: Context<AppEnv>): string | undefined {
  return getCookie(c, REFRESH_COOKIE_NAME);
}

export function clearRefreshCookie(c: Context<AppEnv>): void {
  deleteCookie(c, REFRESH_COOKIE_NAME, {
    path: COOKIE_PATH,
    secure: c.get('config').security.secureCookies,
    httpOnly: true,
    sameSite: 'Strict',
  });
}
