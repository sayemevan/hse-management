import { z } from 'zod';

/**
 * Mobile numbers in international format. Saudi numbers typed as `05XXXXXXXX` are
 * normalised to `+9665XXXXXXXX` (US-011.1).
 */
export function normalizePhone(value: string): string {
  const compact = value.replace(/[\s()-]/g, '');
  if (/^05\d{8}$/.test(compact)) return `+966${compact.slice(1)}`;
  if (/^00\d+$/.test(compact)) return `+${compact.slice(2)}`;
  return compact;
}

export const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'invalidPhone'));
