'use client';

import { DEFAULT_COMPANY_SETTINGS, type DateFormat, type TimeFormat } from '@hse/shared';
import { useLocale } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { useAuth } from '@/modules/auth/auth-provider';
import { useCompany } from '@/modules/tenant/tenant-provider';

export interface DateFormatOptions {
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  timeZone: string;
  locale: string;
}

/**
 * Formats epoch-ms times with the company's date and time formats (US-013 FR-3) in the user's
 * effective time zone. Digits are always Western (O-10); the 12-hour marker is translated.
 */
export function formatDateParts(
  time: number,
  options: DateFormatOptions,
  withTime: boolean,
): string {
  const parts = new Intl.DateTimeFormat(`${options.locale}-u-nu-latn`, {
    timeZone: options.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: options.timeFormat === '12h' ? 'h12' : 'h23',
  }).formatToParts(time);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';

  const [day, month, year] = [part('day'), part('month'), part('year')];
  const date =
    options.dateFormat === 'MM/DD/YYYY'
      ? `${month}/${day}/${year}`
      : options.dateFormat === 'YYYY-MM-DD'
        ? `${year}-${month}-${day}`
        : `${day}/${month}/${year}`;
  if (!withTime) return date;

  const clock = `${part('hour')}:${part('minute')}`;
  const period = part('dayPeriod');
  return `${date} ${options.timeFormat === '12h' && period ? `${clock} ${period}` : clock}`;
}

/** Unicode LEFT-TO-RIGHT ISOLATE (U+2066) and POP DIRECTIONAL ISOLATE (U+2069). */
const LTR_ISOLATE = String.fromCharCode(0x2066);
const POP_ISOLATE = String.fromCharCode(0x2069);

/** `date(ms)` and `dateTime(ms)` for the signed-in user; `—` for null. */
export function useDateFormat() {
  const { user } = useAuth();
  const company = useCompany();
  const locale = useLocale().startsWith('ar') ? 'ar' : 'en';
  const options = useMemo<DateFormatOptions>(
    () => ({
      dateFormat: user?.companySettings?.dateFormat ?? DEFAULT_COMPANY_SETTINGS.dateFormat,
      timeFormat: user?.companySettings?.timeFormat ?? DEFAULT_COMPANY_SETTINGS.timeFormat,
      timeZone: user?.effectiveTimeZone ?? company?.timeZone ?? 'Asia/Riyadh',
      locale,
    }),
    [user, company, locale],
  );
  const date = useCallback(
    (time: number | null) => (time === null ? '—' : formatDateParts(time, options, false)),
    [options],
  );
  const dateTime = useCallback(
    (time: number | null) => (time === null ? '—' : formatDateParts(time, options, true)),
    [options],
  );
  /**
   * A calendar day `YYYY-MM-DD` (project dates, T-36) in the company's date format. Wrapped in
   * a left-to-right isolate so "31-12-2026" doesn't reorder inside an Arabic sentence.
   */
  const calendarDate = useCallback(
    (iso: string | null) => {
      if (iso === null) return '—';
      const text = formatDateParts(
        Date.parse(`${iso}T12:00:00Z`),
        { ...options, timeZone: 'UTC' },
        false,
      );
      return LTR_ISOLATE + text + POP_ISOLATE;
    },
    [options],
  );
  return { date, dateTime, calendarDate, options };
}
