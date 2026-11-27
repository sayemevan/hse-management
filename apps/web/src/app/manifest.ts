import type { MetadataRoute } from 'next';

import { publicEnv } from '@/config/public-env';
import { BROWSER_THEME } from '@/config/theme';

/**
 * Web App Manifest: makes the app installable (Doc 02 §4, PWA).
 * Placeholder icons until the brand assets arrive (O-128); the service worker is PLT-25.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: publicEnv.appName,
    short_name: 'HSE',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: BROWSER_THEME.backgroundColor,
    theme_color: BROWSER_THEME.themeColor,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
