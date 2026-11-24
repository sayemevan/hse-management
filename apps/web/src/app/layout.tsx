import './globals.css';

import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { publicEnv } from '@/config/public-env';
import { BROWSER_THEME } from '@/config/theme';
import { directionOf, languageOfLocale } from '@/i18n/config';
import { AppProviders } from '@/modules/app/app-providers';

// O-6: IBM Plex Sans for Latin text, IBM Plex Sans Arabic for Arabic. Fonts are split by
// unicode-range, so a browser downloads the Arabic files only when Arabic text is on screen.
const latinFont = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-latin',
  display: 'swap',
});
const arabicFont = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600'],
  variable: '--font-arabic',
  display: 'swap',
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const name = (await getTranslations('common'))('platformName');
  return {
    title: { default: name, template: `%s · ${name}` },
    applicationName: publicEnv.appName,
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: BROWSER_THEME.themeColor,
};

/** Root layout: language and direction come from the language cookie (PLT-03). */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const language = languageOfLocale(await getLocale());
  const t = await getTranslations('common');

  return (
    <html
      lang={language}
      dir={directionOf(language)}
      className={`${latinFont.variable} ${arabicFont.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:p-3"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
