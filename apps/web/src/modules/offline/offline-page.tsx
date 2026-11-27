'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { CloudOff } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';

/** The page the service worker shows when a page isn't on the device (PLT-25 FR-4). */
export function OfflinePage() {
  const t = useTranslations('offline.notice');
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <CloudOff aria-hidden className="size-12 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <Link href="/sync" className={buttonVariants({ fullWidth: true })}>
        {t('syncCentre')}
      </Link>
    </div>
  );
}
