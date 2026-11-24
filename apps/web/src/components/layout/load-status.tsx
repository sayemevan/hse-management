'use client';

import { useTranslations } from 'next-intl';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';

/** The loading spinner and the error-with-retry shown while a screen loads its data. */
export function LoadStatus({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  const t = useTranslations('common');
  const errorMessage = useErrorMessage();
  if (error === undefined) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {t('loading')}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert tone="danger">{errorMessage(error)}</Alert>
      <Button variant="secondary" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
