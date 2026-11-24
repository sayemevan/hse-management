'use client';

import { ErrorCode, type ResubmissionFormDto } from '@hse/shared';
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

import { RegistrationForm, type RegistrationFormValues } from './registration-form';
import { registrationService } from './registration.service';

type ScreenState =
  | { status: 'loading' }
  | { status: 'ready'; form: ResubmissionFormDto }
  | { status: 'expired' }
  | { status: 'error'; message: string }
  | { status: 'done' };

function isTokenError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === ErrorCode.TOKEN_INVALID_OR_EXPIRED || error.code === ErrorCode.NOT_FOUND)
  );
}

function toFormValues(form: ResubmissionFormDto): RegistrationFormValues {
  return {
    companyName: form.companyName,
    slug: form.slug,
    countryCode: form.countryCode,
    city: form.city,
    timeZone: form.timeZone,
    defaultLanguage: form.defaultLanguage,
    applicantName: form.applicantName,
    applicantEmail: form.applicantEmail,
    applicantPhone: form.applicantPhone,
    password: '',
    passwordConfirm: '',
    planCode: form.planCode,
    termsAccepted: true,
  };
}

/** Resubmit a rejected application (US-011.5). */
export function ResubmitScreen() {
  const t = useTranslations('registration.resubmit');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const token = useSearchParams().get('token');
  const [state, setState] = useState<ScreenState>(
    token ? { status: 'loading' } : { status: 'expired' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    registrationService.resubmissionForm(token, controller.signal).then(
      (form) => {
        setState({ status: 'ready', form });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          isTokenError(error)
            ? { status: 'expired' }
            : { status: 'error', message: errorMessage(error) },
        );
      },
    );
    return () => {
      controller.abort();
    };
  }, [token, attempt, errorMessage]);

  if (state.status === 'loading') {
    return (
      <PublicPage>
        <div role="status" className="flex items-center gap-3 text-muted-foreground">
          <Spinner />
          <span>{tc('loading')}</span>
        </div>
      </PublicPage>
    );
  }

  if (state.status === 'error') {
    return (
      <PublicPage>
        <div className="flex flex-col gap-4">
          <Alert tone="danger">{state.message}</Alert>
          <Button
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((current) => current + 1);
            }}
          >
            {tc('retry')}
          </Button>
        </div>
      </PublicPage>
    );
  }

  if (state.status === 'expired') {
    return (
      <PublicPage>
        <div className="flex flex-col gap-4">
          <Clock aria-hidden className="size-10 text-warning-foreground" />
          <h1 className="text-2xl font-semibold">{t('expiredTitle')}</h1>
          <p className="text-muted-foreground">{t('expiredBody')}</p>
          <Link
            href="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('startNew')}
          </Link>
        </div>
      </PublicPage>
    );
  }

  if (state.status === 'done') {
    return (
      <PublicPage>
        <div className="flex flex-col gap-4">
          <CircleCheck aria-hidden className="size-10 text-success" />
          <h1 className="text-2xl font-semibold">{t('doneTitle')}</h1>
          <p className="text-muted-foreground">{t('doneBody')}</p>
        </div>
      </PublicPage>
    );
  }

  const { form } = state;
  return (
    <PublicPage wide>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <RegistrationForm
          mode="resubmit"
          initial={toFormValues(form)}
          ownSlug={form.slug}
          notice={
            <Alert tone="warning">
              <p className="font-medium">{t('changesRequested')}</p>
              <p className="mt-1 whitespace-pre-line" dir="auto">
                {form.rejectionReason}
              </p>
            </Alert>
          }
          onSubmit={async ({ values, turnstileToken, applicantLanguage }) => {
            try {
              await registrationService.resubmit({
                token: token ?? '',
                companyName: values.companyName,
                slug: values.slug,
                countryCode: values.countryCode,
                city: values.city,
                timeZone: values.timeZone,
                defaultLanguage: values.defaultLanguage,
                applicantName: values.applicantName,
                applicantPhone: values.applicantPhone,
                planCode: values.planCode,
                applicantLanguage,
                turnstileToken,
                ...(values.password ? { password: values.password } : {}),
              });
              setState({ status: 'done' });
            } catch (error) {
              if (isTokenError(error)) {
                setState({ status: 'expired' });
                return;
              }
              throw error;
            }
          }}
        />
      </div>
    </PublicPage>
  );
}
