import type { AppConfig } from '../../config/config';

/** A URL on the platform (base domain), e.g. for review links in emails. */
export function platformUrl(config: AppConfig, path: string): string {
  return `${config.platformUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * A URL on a company's subdomain: the platform URL with `<slug>.` in front of its host,
 * keeping scheme and port (http://localhost:3000 → http://acme.localhost:3000).
 */
export function companyUrl(config: AppConfig, slug: string, path: string): string {
  const url = new URL(config.platformUrl);
  url.hostname = `${slug}.${url.hostname}`;
  url.pathname = path.startsWith('/') ? path : `/${path}`;
  return url.toString();
}
