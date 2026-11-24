'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useReadOnly } from './use-subscription-state';

/** Why a control is disabled in read-only mode (PLT-11 FR-7). Renders nothing otherwise. */
export function ReadOnlyHint({ id }: { id?: string }) {
  const t = useTranslations('subscriptionBanner');
  if (!useReadOnly()) return null;
  return (
    <p id={id} className="flex items-center gap-2 text-sm text-muted-foreground">
      <Lock aria-hidden className="size-4 shrink-0" />
      {t('readOnlyHint')}
    </p>
  );
}
