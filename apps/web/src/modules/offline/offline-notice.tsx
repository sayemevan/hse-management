'use client';

import { CloudOff } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { buttonVariants } from '@/components/ui/button';

import { offlineRoutes } from './registry';

/** The offline-capable screens offered from the offline notice (labels in `offline.routes`). */
const ROUTE_LABELS: Record<string, string> = {
  '/dev/sync-probe': 'syncProbe',
};

/**
 * PLT-25 FR-4: "You're offline. This page needs a connection." with what still works: the
 * sync centre and the offline-capable screens that exist.
 */
export function OfflineNotice() {
  const t = useTranslations('offline.notice');
  const routes = offlineRoutes().filter((route) => ROUTE_LABELS[route]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
      <CloudOff aria-hidden className="size-12 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <div className="flex w-full flex-col gap-2">
        <Link href="/sync" className={buttonVariants({ fullWidth: true })}>
          {t('syncCentre')}
        </Link>
        {routes.map((route) => (
          <Link
            key={route}
            href={route}
            className={buttonVariants({ variant: 'secondary', fullWidth: true })}
          >
            {t(`routes.${ROUTE_LABELS[route] ?? 'syncProbe'}` as 'routes.syncProbe')}
          </Link>
        ))}
      </div>
    </div>
  );
}
