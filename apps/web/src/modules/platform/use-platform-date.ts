'use client';

import { useFormatter } from 'next-intl';
import { useCallback } from 'react';

import { useAuth } from '@/modules/auth/auth-provider';

/** Formats an epoch-ms timestamp in the reviewer's time zone (or the browser's). */
export function usePlatformDate(): (time: number | null) => string {
  const format = useFormatter();
  const { user } = useAuth();
  const timeZone = user?.timeZone ?? undefined;
  return useCallback(
    (time) =>
      time === null
        ? '—'
        : format.dateTime(time, {
            dateStyle: 'medium',
            timeStyle: 'short',
            ...(timeZone ? { timeZone } : {}),
          }),
    [format, timeZone],
  );
}
