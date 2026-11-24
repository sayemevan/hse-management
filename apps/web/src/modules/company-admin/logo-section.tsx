'use client';

import { LOGO_RULES } from '@hse/shared';
import { Building2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { FileDropzone } from '@/components/form/file-dropzone';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useReloadTenant } from '@/modules/tenant/tenant-provider';
import { ReadOnlyHint } from '@/modules/billing/read-only-hint';
import { useReadOnly } from '@/modules/billing/use-subscription-state';

import { companyService } from './company.service';

const MAX_MB = LOGO_RULES.maxBytes / (1024 * 1024);

/** Company logo (US-014): preview on light and dark, save, replace and remove. */
export function LogoSection({
  companyName,
  logoUrl,
  onChange,
}: {
  companyName: string;
  logoUrl: string | null;
  onChange: (logoUrl: string | null) => void;
}) {
  const t = useTranslations('companySettings.logo');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const reloadTenant = useReloadTenant();
  const [chosen, setChosen] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // A local preview of the chosen file, released when it changes or the section closes.
  const preview = useMemo(() => (chosen ? URL.createObjectURL(chosen) : null), [chosen]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const choose = (file: File) => {
    setSaved(null);
    setError(null);
    // Quick checks for feedback; the server checks the real type (PLT-07 FR-3).
    if (!(LOGO_RULES.contentTypes as readonly string[]).includes(file.type)) {
      setChosen(null);
      setError(t('wrongType'));
      return;
    }
    if (file.size > LOGO_RULES.maxBytes) {
      setChosen(null);
      setError(t('tooLarge', { max: MAX_MB }));
      return;
    }
    setChosen(file);
  };

  const save = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const result = await companyService.uploadLogo(chosen);
      setChosen(null);
      setSaved(t('savedMessage'));
      onChange(result.logoUrl);
      reloadTenant();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setBusy(true);
    setError(null);
    try {
      await companyService.removeLogo();
      setSaved(t('removedMessage'));
      onChange(null);
      reloadTenant();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? logoUrl;
  const alt = t('alt', { company: companyName });

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      {saved ? <Alert tone="success">{saved}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid grid-cols-2 gap-3">
        {(['light', 'dark'] as const).map((background) => (
          <div
            key={background}
            className={
              background === 'light'
                ? 'flex h-24 items-center justify-center rounded-lg border border-border bg-white'
                : 'flex h-24 items-center justify-center rounded-lg border border-border bg-neutral-900'
            }
          >
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by the API from R2 (PLT-07)
              <img src={shown} alt={alt} className="max-h-16 max-w-[80%] object-contain" />
            ) : (
              <Building2
                aria-hidden
                className={
                  background === 'light' ? 'size-8 text-neutral-400' : 'size-8 text-neutral-500'
                }
              />
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('previewHint')}</p>

      <FileDropzone
        label={t('choose')}
        hint={t('rules', { max: MAX_MB })}
        accept={LOGO_RULES.contentTypes.join(',')}
        disabled={readOnly || busy}
        invalid={Boolean(error)}
        onFile={choose}
      />
      <ReadOnlyHint />

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {logoUrl && !chosen ? (
          <Button
            variant="ghost"
            disabled={readOnly || busy}
            onClick={() => {
              setConfirmRemove(true);
            }}
          >
            <Trash2 aria-hidden className="size-5" />
            {t('remove')}
          </Button>
        ) : null}
        {chosen ? (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setChosen(null);
              }}
            >
              {tc('cancel')}
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? <Spinner /> : null}
              {busy ? t('saving') : t('save')}
            </Button>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={t('removeTitle')}
        body={t('removeBody')}
        confirmLabel={t('remove')}
        cancelLabel={tc('cancel')}
        tone="danger"
        onConfirm={() => void remove()}
        onCancel={() => {
          setConfirmRemove(false);
        }}
      />
    </Card>
  );
}
