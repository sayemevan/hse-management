import { type Language, LANGUAGES } from '@hse/shared';

export const DEFAULT_LANGUAGE: Language = 'en';

/** Cookie that remembers the visitor's language on this device (PLT-03). */
export const LANGUAGE_COOKIE = 'hse-language';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Text direction per language. */
export function directionOf(language: Language): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr';
}

/**
 * BCP-47 tag used for all formatting. Arabic uses Western digits (O-10) so record numbers,
 * dates and counts look identical in both languages, in reports and in search.
 */
export function formattingLocale(language: Language): string {
  return language === 'ar' ? 'ar-u-nu-latn' : 'en';
}

export function languageOfLocale(locale: string): Language {
  const language = locale.split('-')[0];
  return isLanguage(language) ? language : DEFAULT_LANGUAGE;
}

export function languageCookieValue(language: Language): string {
  return `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}
