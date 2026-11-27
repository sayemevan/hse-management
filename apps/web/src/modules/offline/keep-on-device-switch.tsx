'use client';

import { HardDriveDownload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

import { useAuth } from '@/modules/auth/auth-provider';

import { isPinned, OfflineProjectLimitError, setPinned } from './offline-profile';
import { useSync } from './sync-provider';

/** PLT-26: "Keep on this device" on the project page (disabled offline). */
export function KeepOnDeviceSwitch({ projectId }: { projectId: string }) {
  const t = useTranslations('offline.keep');
  const { user } = useAuth();
  const { online, available } = useSync();
  const id = useId();
  const [pinned, setPinnedState] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    isPinned(user.id, projectId).then(setPinnedState, () => {
      setPinnedState(false);
    });
  }, [user, projectId]);

  if (!user || !available || pinned === null) return null;

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setPinned(user.id, projectId, next);
      setPinnedState(next);
    } catch (failure) {
      setError(failure instanceof OfflineProjectLimitError ? t('limit') : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border p-4">
      <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center gap-3">
        <HardDriveDownload aria-hidden className="size-5 shrink-0" />
        <span className="flex-1 font-medium">{t('label')}</span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="size-6"
          checked={pinned}
          disabled={!online || busy}
          onChange={(event) => void toggle(event.target.checked)}
        />
      </label>
      <p className="text-sm text-muted-foreground">{online ? t('help') : t('offline')}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
