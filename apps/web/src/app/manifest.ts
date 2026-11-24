import type { MetadataRoute } from 'next';

import { publicEnv } from '@/config/public-env';
import { BROWSER_THEME } from '@/config/theme';

/**
 * Web App Manifest: makes the app installable (Doc 02 §4, PWA).
 * Icons are added with the brand assets; offline support (service worker) depends on Q-26.
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
    icons: [],
  };
}
