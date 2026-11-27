import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Local development only: forward /api/* to the Wrangler dev server so the browser sees one
// origin (T-4). In deployed environments a Workers route sends /api/* to the API Worker
// before it reaches this app, so no proxy is configured there.
const apiProxyOrigin = process.env.API_PROXY_ORIGIN;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@hse/shared'],
  // Company subdomains (<slug>.localhost) are used during development (PLT-02).
  allowedDevOrigins: ['*.localhost'],
  // PLT-25: the service worker is always checked for a new version and controls the whole site.
  headers: () =>
    Promise.resolve([
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]),
  ...(apiProxyOrigin
    ? {
        rewrites: () =>
          Promise.resolve([{ source: '/api/:path*', destination: `${apiProxyOrigin}/api/:path*` }]),
      }
    : {}),
};

export default withNextIntl(nextConfig);
