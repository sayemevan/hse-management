'use client';

import { Download, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { usePwa } from './pwa-provider';

/** PLT-25 FR-5 / O-125: "Update available — Reload", never reloading over unsaved input. */
export function UpdateBanner() {
  const t = useTranslations('offline.update');
  const { updateAvailable, applyUpdate } = usePwa();
  const pathname = usePathname();
  const [dismissedOn, setDismissedOn] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  if (!updateAvailable || dismissedOn === pathname) return null;

  return (
    <div role="status" className="border-t border-border bg-info-surface text-info-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2 text-sm">
        <Download aria-hidden className="size-5 shrink-0" />
        <span className="flex-1">{refused ? t('unsaved') : t('available')}</span>
        <Button
          size="sm"
          onClick={() => {
            setRefused(!applyUpdate());
          }}
        >
          {t('reload')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('dismiss')}
          onClick={() => {
            setDismissedOn(pathname);
          }}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
