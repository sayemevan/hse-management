import { isValidSlug } from '@hse/shared';

export type HostResolution =
  { kind: 'platform' } | { kind: 'company'; slug: string } | { kind: 'unknown' };

/**
 * Maps a request host to its context (PLT-02):
 * `<base>` and `www.<base>` → platform; `<slug>.<base>` → company; anything else → unknown.
 * Ports are ignored. Only one subdomain level is allowed.
 */
export function resolveHost(host: string | undefined, baseDomain: string): HostResolution {
  if (!host) return { kind: 'unknown' };

  const hostname = stripPort(host.trim().toLowerCase());
  if (hostname === baseDomain || hostname === `www.${baseDomain}`) return { kind: 'platform' };

  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) return { kind: 'unknown' };

  const slug = hostname.slice(0, -suffix.length);
  if (slug.includes('.') || !isValidSlug(slug)) return { kind: 'unknown' };
  return { kind: 'company', slug };
}

function stripPort(host: string): string {
  // IPv6 literals ("[::1]:8787") never match a base domain, so a simple split is enough.
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}
