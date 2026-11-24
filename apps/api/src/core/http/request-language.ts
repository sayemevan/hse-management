import { type Language, LANGUAGES } from '@hse/shared';
import type { Context } from 'hono';

import type { AppEnv } from '../context/app-context';

/**
 * The caller's language for public responses such as plan names: `?lang=` first, then the
 * Accept-Language header, then English.
 */
export function requestLanguage(c: Context<AppEnv>): Language {
  const explicit = c.req.query('lang');
  if (explicit && (LANGUAGES as readonly string[]).includes(explicit)) return explicit as Language;
  const header = c.req.header('accept-language')?.toLowerCase() ?? '';
  return header.startsWith('ar') ? 'ar' : 'en';
}
