'use client';

import { NOTIFICATION_POLL_MS } from '@hse/shared';
import { ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { myActionsService } from './actions.service';

/** PLT-24 FR-7: header link with the caller's overdue count, refreshed like the bell (T-42). */
export function MyActionsLink() {
  const t = useTranslations('actions.mine');
  const [overdue, setOverdue] = useState(0);

  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    myActionsService.summary().then(
      (summary) => {
        setOverdue(summary.overdue);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, NOTIFICATION_POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh]);

  const label = overdue > 0 ? t('linkOverdue', { count: overdue }) : t('title');
  return (
    <Link
      href="/my-actions"
      aria-label={label}
      className="relative inline-flex min-h-12 items-center gap-2 rounded-lg px-3 font-medium hover:bg-muted"
    >
      <ListChecks aria-hidden className="size-5" />
      <span className="sr-only sm:not-sr-only">{t('title')}</span>
      {overdue > 0 ? (
        <span
          aria-hidden
          className="absolute end-1 top-1 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-semibold text-white tabular-nums"
        >
          {overdue > 99 ? '99+' : overdue}
        </span>
      ) : null}
    </Link>
  );
}
