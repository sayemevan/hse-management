import type { Context } from 'hono';

import type { AppEnv } from '../context/app-context';

const MAX_USER_AGENT_LENGTH = 512;

export interface RequestMeta {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Client facts recorded with sessions and audit entries.
 * `cf-connecting-ip` is set by Cloudflare's edge and cannot be spoofed by the client there;
 * `x-forwarded-for` is used only behind the trusted local dev proxy.
 */
export function requestMeta(c: Context<AppEnv>): RequestMeta {
  const forwarded = c.get('config').tenancy.trustForwardedHost
    ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    : undefined;
  const ipAddress = c.req.header('cf-connecting-ip') ?? forwarded ?? null;
  const userAgent = c.req.header('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null;
  return { requestId: c.get('requestId'), ipAddress, userAgent };
}

export interface DeviceInfo {
  deviceLabel: string;
  browser: string;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/EdgA?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const DEVICES: readonly [RegExp, string][] = [
  [/iPad/, 'iPad'],
  [/iPhone/, 'iPhone'],
  [/Android.*Mobile/, 'Android phone'],
  [/Android/, 'Android tablet'],
  [/Windows/, 'Windows computer'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/CrOS/, 'Chromebook'],
  [/Linux/, 'Linux computer'],
];

/** A short, human-readable device description for the sessions list (US-010). */
export function describeDevice(userAgent: string | null): DeviceInfo {
  if (!userAgent) return { deviceLabel: 'Unknown device', browser: 'Unknown browser' };
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Unknown browser';
  const deviceLabel = DEVICES.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Unknown device';
  return { deviceLabel, browser };
}
