import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_LANGUAGE, formattingLocale, isLanguage, LANGUAGE_COOKIE } from './config';

/**
 * Language comes from a cookie, not the URL (T-6): device choice → company default →
 * English. The tenant provider fills the cookie with the company default on a first visit,
 * and the user's saved preference replaces it after sign-in (D-21).
 */
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  const language = isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  const messages = (await import(`../../messages/${language}.json`)) as {
    default: Record<string, unknown>;
  };
  return {
    locale: formattingLocale(language),
    messages: messages.default,
  };
});
