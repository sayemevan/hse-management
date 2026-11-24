'use client';

import { useLocale } from 'next-intl';
import { useCallback } from 'react';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

/** SAR with two decimals and Western digits in both languages (O-10). */
export function useMoney(): (riyals: number) => string {
  const locale = useLocale().startsWith('ar') ? 'ar' : 'en';
  return useCallback(
    (riyals) =>
      new Intl.NumberFormat(`${locale}-u-nu-latn`, {
        style: 'currency',
        currency: 'SAR',
        minimumFractionDigits: 2,
      }).format(riyals),
    [locale],
  );
}

/** Bytes as GB or MB with one decimal, for usage and quotas. */
export function sizeParts(bytes: number): { unit: 'gb' | 'mb'; value: number } {
  return bytes >= GB
    ? { unit: 'gb', value: Math.round((bytes / GB) * 10) / 10 }
    : { unit: 'mb', value: Math.round((bytes / MB) * 10) / 10 };
}
