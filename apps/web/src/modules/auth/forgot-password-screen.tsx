'use client';

import { ArrowLeft, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useState } from 'react';
import { z } from 'zod';

import { FormField } from '@/components/form/form-field';
import { PublicPage } from '@/components/layout/public-page';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';

import { authService } from './auth.service';

const emailFormat = z.email();
/** US-002 UI: "Send again" appears after 60 seconds. */
const SEND_AGAIN_DELAY_MS = 60_000;

/** Forgot password (US-002). The answer never says whether the address has an account. */
export function ForgotPasswordScreen() {
  const t = useTranslations('forgotPassword');
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Number of successful sends; each one restarts the "Send again" delay.
  const [sends, setSends] = useState(0);
  const sent = sends > 0;
  const [canResend, setCanResend] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (sends === 0) return;
    const timer = setTimeout(() => {
      setCanResend(true);
    }, SEND_AGAIN_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [sends]);

  const send = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setFieldError(t('emailRequired'));
      return;
    }
    if (!emailFormat.safeParse(trimmed).success) {
      setFieldError(t('emailInvalid'));
      return;
    }
    setFieldError(null);
    setCanResend(false);
    setFormError(null);
    setSubmitting(true);
    try {
      await authService.forgotPassword(trimmed);
      setSends((count) => count + 1);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const back = (
    <Link
      href="/login"
      className="inline-flex min-h-12 items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-5 rtl:-scale-x-100" />
      {t('back')}
    </Link>
  );

  return (
    <PublicPage>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          {sent ? null : <p className="text-muted-foreground">{t('intro')}</p>}
        </div>

        {sent ? (
          <>
            <Alert tone="success">
              <span className="inline-flex items-center gap-2">
                <MailCheck aria-hidden className="size-5" />
                {t('sent')}
              </span>
            </Alert>
            {canResend ? (
              <Button
                variant="link"
                className="self-start px-0"
                disabled={submitting}
                onClick={() => void send()}
              >
                {t('sendAgain')}
              </Button>
            ) : null}
          </>
        ) : (
          <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <FormField
              id="email"
              label={t('email')}
              required
              requiredLabel={t('email')}
              error={fieldError}
            >
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? 'email-error' : undefined}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </FormField>
            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? <Spinner /> : null}
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </form>
        )}
        {back}
      </div>
    </PublicPage>
  );
}
