'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';

import { otherUsersWaiting } from './outbox';

/**
 * PLT-27 FR-7 / O-118: on the sign-in page, say that unsynced items wait on this device. No
 * names: they sync only after their own user signs in here again.
 */
export function WaitingItemsNotice() {
  const t = useTranslations('offline.signIn');
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    otherUsersWaiting(null).then(setWaiting, () => undefined);
  }, []);
  if (!waiting) return null;
  return <Alert tone="info">{t('waiting')}</Alert>;
}
