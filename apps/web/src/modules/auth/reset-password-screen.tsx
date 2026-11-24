'use client';

import { ErrorCode } from '@hse/shared';
import { CircleCheck, Clock } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useCallback, useState } from 'react';

import { PublicPage } from '@/components/layout/public-page';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';

import { authService } from './auth.service';
import {
  NewPasswordFields,
  type NewPasswordErrors,
  useNewPasswordValidation,
} from './new-password-fields';

type State =
  | { status: 'checking' }
  | { status: 'ready'; email: string }
  | { status: 'expired' }
  | { status: 'error' }
  | { status: 'done' };

function isExpired(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === ErrorCode.TOKEN_INVALID_OR_EXPIRED ||
      error.code === ErrorCode.VALIDATION_FAILED)
  );
}

/** Reset password from the emailed link (US-003). Opening the page changes nothing (FR-1). */
export function ResetPasswordScreen() {
  const t = useTranslations('resetPassword');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const validate = useNewPasswordValidation();
  const token = useSearchParams().get('token') ?? '';
  const [outcome, setOutcome] = useState<'done' | 'expired' | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<NewPasswordErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadPreview = useCallback(
    () => (token ? authService.resetPreview(token) : Promise.resolve(null)),
    [token],
  );
  const preview = useLoad(loadPreview, token);
  const check = preview.reload;
  const state: State = outcome
    ? { status: outcome }
    : preview.status === 'loading'
      ? { status: 'checking' }
      : preview.status === 'error'
        ? { status: isExpired(preview.error) ? 'expired' : 'error' }
        : preview.value
          ? { status: 'ready', email: preview.value.email }
          : { status: 'expired' };
  const setState = (next: { status: 'done' | 'expired' }) => {
    setOutcome(next.status);
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate(password, confirm);
    setErrors(found);
    setFormError(null);
    if (found.password || found.confirm) return;
    setSubmitting(true);
    try {
      await authService.resetPassword(token, password);
      setState({ status: 'done' });
    } catch (error) {
      if (error instanceof ApiClientError && error.code === ErrorCode.TOKEN_INVALID_OR_EXPIRED) {
        setState({ status: 'expired' });
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicPage>
      {state.status === 'checking' ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {t('checking')}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="flex flex-col gap-4">
          <Alert tone="danger">{errorMessage(null)}</Alert>
          <Button className="self-start" onClick={check}>
            {tc('retry')}
          </Button>
        </div>
      ) : null}

      {state.status === 'expired' ? (
        <div className="flex flex-col items-start gap-4">
          <Clock aria-hidden className="size-10 text-warning" />
          <h1 className="text-2xl font-semibold">{t('expiredTitle')}</h1>
          <p className="text-muted-foreground">{t('expiredBody')}</p>
          <Link href="/forgot-password" className={buttonVariants({ variant: 'primary' })}>
            {t('requestNew')}
          </Link>
        </div>
      ) : null}

      {state.status === 'done' ? (
        <div className="flex flex-col items-start gap-4">
          <CircleCheck aria-hidden className="size-10 text-success" />
          <h1 className="text-2xl font-semibold">{t('doneTitle')}</h1>
          <p className="text-muted-foreground">{t('doneBody')}</p>
          <Link href="/login" className={buttonVariants({ variant: 'primary' })}>
            {t('signIn')}
          </Link>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="text-muted-foreground">
              {t.rich('intro', { email: () => <bdi dir="ltr">{state.email}</bdi> })}
            </p>
          </div>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <NewPasswordFields
            password={password}
            confirm={confirm}
            errors={errors}
            onPasswordChange={setPassword}
            onConfirmChange={setConfirm}
          />
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? <Spinner /> : null}
            {submitting ? t('submitting') : t('submit')}
          </Button>
        </form>
      ) : null}
    </PublicPage>
  );
}
