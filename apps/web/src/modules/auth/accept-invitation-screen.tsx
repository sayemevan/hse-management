'use client';

import { ErrorCode, type InvitationPreviewDto } from '@hse/shared';
import { Clock } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useCallback, useState } from 'react';

import { PublicPage } from '@/components/layout/public-page';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { ApiClientError } from '@/services/api-client';

import { authService } from './auth.service';
import { useAuth } from './auth-provider';
import {
  NewPasswordFields,
  type NewPasswordErrors,
  useNewPasswordValidation,
} from './new-password-fields';

type State =
  | { status: 'checking' }
  | { status: 'ready'; invitation: InvitationPreviewDto }
  | { status: 'expired' }
  | { status: 'error' };

function isExpired(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === ErrorCode.TOKEN_INVALID_OR_EXPIRED;
}

/** Accept an invitation (US-006): set a password, then the user is signed in. */
export function AcceptInvitationScreen() {
  const t = useTranslations('acceptInvitation');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const validate = useNewPasswordValidation();
  const router = useRouter();
  const { adoptSession } = useAuth();
  const token = useSearchParams().get('token') ?? '';
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<NewPasswordErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadPreview = useCallback(
    () => (token ? authService.invitationPreview(token) : Promise.resolve(null)),
    [token],
  );
  const preview = useLoad(loadPreview, token);
  const check = preview.reload;
  const state: State = expired
    ? { status: 'expired' }
    : preview.status === 'loading'
      ? { status: 'checking' }
      : preview.status === 'error'
        ? { status: isExpired(preview.error) ? 'expired' : 'error' }
        : preview.value
          ? { status: 'ready', invitation: preview.value }
          : { status: 'expired' };
  const setState = (_next: { status: 'expired' }) => {
    setExpired(true);
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate(password, confirm);
    setErrors(found);
    setFormError(null);
    if (found.password || found.confirm) return;
    setSubmitting(true);
    try {
      adoptSession(await authService.acceptInvitation({ token, password }));
      router.replace('/');
    } catch (error) {
      if (isExpired(error)) setState({ status: 'expired' });
      else setFormError(errorMessage(error));
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
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">
              {t('title', { company: state.invitation.companyName })}
            </h1>
            <p className="text-muted-foreground">{t('intro')}</p>
          </div>
          <dl className="grid gap-3 rounded-lg bg-muted p-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('name')}</dt>
              <dd className="font-medium">
                <bdi>{state.invitation.fullName}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('email')}</dt>
              <dd className="font-medium">
                <bdi dir="ltr">{state.invitation.email}</bdi>
              </dd>
            </div>
          </dl>
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
