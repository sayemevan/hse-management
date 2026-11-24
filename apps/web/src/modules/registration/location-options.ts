import { COUNTRY_CODES, GCC_COUNTRY_CODES } from '@hse/shared';

export interface CountryOption {
  code: string;
  name: string;
}

/**
 * Country options in the user's language (O-17): Saudi Arabia and the GCC first, in the
 * agreed order, then every other country sorted by its translated name.
 */
export function countryOptions(locale: string): { gcc: CountryOption[]; others: CountryOption[] } {
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' });
  const toOption = (code: string): CountryOption => ({ code, name: names.of(code) ?? code });
  const gccCodes = new Set<string>(GCC_COUNTRY_CODES);
  const collator = new Intl.Collator(locale);
  return {
    gcc: GCC_COUNTRY_CODES.map(toOption),
    others: COUNTRY_CODES.filter((code) => !gccCodes.has(code))
      .map(toOption)
      .sort((a, b) => collator.compare(a.name, b.name)),
  };
}

/** IANA time zones the browser knows, always including `current` (e.g. a stored value). */
export function timeZoneOptions(current: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone').filter((zone) => zone.includes('/'));
  if (current && !zones.includes(current)) zones.unshift(current);
  return zones;
}
