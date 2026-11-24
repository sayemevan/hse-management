'use client';

import type { Language } from '@hse/shared';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useCallback } from 'react';

import { directionOf, LANGUAGE_COOKIE, languageCookieValue, languageOfLocale } from '@/i18n/config';

export function hasLanguageCookie(): boolean {
  return document.cookie.split(';').some((part) => part.trim().startsWith(`${LANGUAGE_COOKIE}=`));
}

/** The active language and a way to switch it without a full page reload (PLT-03). */
export function useLanguage() {
  const router = useRouter();
  const language = languageOfLocale(useLocale());

  const applyLanguage = useCallback(
    (next: Language) => {
      // The cookie is a per-device preference, not a secret; it must be readable by the server.
      document.cookie = languageCookieValue(next);
      // Compare with the document too: two quick switches (e.g. the saved preference arriving
      // while the user picks another language) can leave the page and the locale out of step.
      if (next !== language || document.documentElement.lang !== next) {
        document.documentElement.lang = next;
        document.documentElement.dir = directionOf(next);
        router.refresh();
      }
    },
    [language, router],
  );

  return { language, applyLanguage };
}
