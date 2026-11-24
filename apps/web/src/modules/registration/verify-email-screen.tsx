'use client';

import { ErrorCode } from '@hse/shared';
import { CircleCheck, Clock } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { PublicPage } from '@/components/layout/public-page';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';

import { registrationService } from './registration.service';
import { ResendLinkForm } from './resend-link-form';

type VerifyResult =
  { status: 'verified' } | { status: 'expired' } | { status: 'error'; error: unknown };
type VerifyState = VerifyResult | { status: 'checking' };

/**
 * Tokens are single use, so each token is sent once per page load even though React's
 * strict mode runs effects twice in development.
 */
const verifications = new Map<string, Promise<VerifyResult>>();

function verifyOnce(token: string): Promise<VerifyResult> {
  let pending = verifications.get(token);
  if (!pending) {
    pending = registrationService.verifyEmail(token).then(
      (): VerifyResult => ({ status: 'verified' }),
      (error: unknown): VerifyResult => {
        const expired =
          error instanceof ApiClientError &&
          (error.code === ErrorCode.TOKEN_INVALID_OR_EXPIRED ||
            error.code === ErrorCode.VALIDATION_FAILED);
        // Only a definite answer is kept; a network error may be retried.
        if (!expired) verifications.delete(token);
        return expired ? { status: 'expired' } : { status: 'error', error };
      },
    );
    verifications.set(token, pending);
  }
  return pending;
}

/** Email verified / link expired (US-011.2). */
export function VerifyEmailScreen() {
  const t = useTranslations('registration.verify');
  const token = useSearchParams().get('token');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<VerifyState>(
    token ? { status: 'checking' } : { status: 'expired' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    const effect = { cancelled: false };
    void verifyOnce(token).then((result) => {
      if (!effect.cancelled) setState(result);
    });
    return () => {
      effect.cancelled = true;
    };
  }, [token, attempt]);

  return (
    <PublicPage>
      {state.status === 'checking' ? (
        <div role="status" className="flex items-center gap-3 text-muted-foreground">
          <Spinner />
          <span>{t('checking')}</span>
        </div>
      ) : null}

      {state.status === 'verified' ? (
        <div className="flex flex-col gap-4">
          <CircleCheck aria-hidden className="size-10 text-success" />
          <h1 className="text-2xl font-semibold">{t('successTitle')}</h1>
          <p className="text-muted-foreground">{t('successBody')}</p>
          <p className="text-muted-foreground">{t('successNext')}</p>
          <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('home')}
          </Link>
        </div>
      ) : null}

      {state.status === 'expired' ? (
        <div className="flex flex-col gap-4">
          <Clock aria-hidden className="size-10 text-warning-foreground" />
          <h1 className="text-2xl font-semibold">{t('expiredTitle')}</h1>
          <p className="text-muted-foreground">{t('expiredBody')}</p>
          <ResendLinkForm submitLabel={t('sendNewLink')} />
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="flex flex-col gap-4">
          <Alert tone="danger">{errorMessage(state.error)}</Alert>
          <Button
            onClick={() => {
              setState({ status: 'checking' });
              setAttempt((current) => current + 1);
            }}
          >
            {tc('retry')}
          </Button>
        </div>
      ) : null}
    </PublicPage>
  );
}
