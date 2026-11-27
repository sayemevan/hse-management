'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

import { discardAll } from './outbox';
import { useSync } from './sync-provider';

/**
 * PLT-31 / O-119: signing out with unsynced items. Sync now (online), Sign out and keep them on
 * this device (default), or Discard and sign out after a second confirmation.
 */
export function SignOutDialog({
  open,
  userId,
  onCancel,
  onSignOut,
}: {
  open: boolean;
  userId: string;
  onCancel: () => void;
  onSignOut: () => void;
}) {
  const t = useTranslations('offline.signOut');
  const { online, items, syncNow } = useSync();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [step, setStep] = useState<'choose' | 'discard'>('choose');
  const [busy, setBusy] = useState(false);
  const unsynced = items.filter((item) => item.state !== 'synced');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const close = () => {
    setStep('choose');
    onCancel();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-6 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-xl sm:border sm:border-border sm:shadow-xl"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {step === 'choose' ? t('title', { count: unsynced.length }) : t('discardTitle')}
      </h2>
      {step === 'choose' ? (
        <>
          <p className="mt-2 text-muted-foreground">{t('body')}</p>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              disabled={!online || busy}
              onClick={() => {
                setBusy(true);
                void syncNow().finally(() => {
                  setBusy(false);
                  onSignOut();
                });
              }}
            >
              {busy ? <Spinner /> : null}
              {online ? t('syncFirst') : t('syncFirstOffline')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onSignOut}>
              {t('keep')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setStep('discard');
              }}
            >
              {t('discard')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={close}>
              {t('cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-muted-foreground">{t('discardBody')}</p>
          <ul className="mt-3 max-h-60 list-disc overflow-auto ps-6 text-sm">
            {unsynced.map((item) => (
              <li key={item.seq}>
                <bdi>{item.label}</bdi>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setStep('choose');
              }}
            >
              {t('back')}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void discardAll(userId).finally(() => {
                  setBusy(false);
                  onSignOut();
                });
              }}
            >
              {t('discardConfirm')}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
