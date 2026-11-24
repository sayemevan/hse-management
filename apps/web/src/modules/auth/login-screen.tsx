'use client';

import { EMAIL_MAX_LENGTH, PASSWORD_POLICY } from '@hse/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useState } from 'react';
import { z } from 'zod';

import { FormField } from '@/components/form/form-field';
import { PublicPage } from '@/components/layout/public-page';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useCompany } from '@/modules/tenant/tenant-provider';

import { useAuth } from './auth-provider';
import { safeRedirectPath } from './safe-redirect';

interface FieldErrors {
  email?: string;
  password?: string;
}

const emailFormat = z.email();

/** Sign-in page (US-001). */
export function LoginScreen() {
  const t = useTranslations();
  const company = useCompany();
  const { status, signIn } = useAuth();
  const router = useRouter();
  const next = safeRedirectPath(useSearchParams().get('next'));
  const errorMessage = useErrorMessage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'signed-in') router.replace(next);
  }, [status, router, next]);

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    const trimmed = email.trim();
    if (!trimmed) errors.email = t('login.emailRequired');
    else if (!emailFormat.safeParse(trimmed).success) errors.email = t('login.emailInvalid');
    if (!password) errors.password = t('login.passwordRequired');
    return errors;
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email || errors.password) return;

    setSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
      router.replace(next);
    } catch (error) {
      setFormError(errorMessage(error));
      setPassword('');
      setSubmitting(false);
    }
  };

  return (
    <PublicPage>
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            {company ? t('login.title') : t('login.platformTitle')}
          </h1>
          <p className="text-muted-foreground">
            {company
              ? t.rich('login.subtitle', { company: () => <bdi>{company.name}</bdi> })
              : t('login.platformSubtitle')}
          </p>
        </div>

        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <FormField
          id="email"
          label={t('login.email')}
          required
          requiredLabel={t('common.required')}
          error={fieldErrors.email}
        >
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            maxLength={EMAIL_MAX_LENGTH}
            value={email}
            invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            required
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </FormField>

        <FormField
          id="password"
          label={t('login.password')}
          required
          requiredLabel={t('common.required')}
          error={fieldErrors.password}
        >
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            maxLength={PASSWORD_POLICY.maxLength}
            value={password}
            invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            required
            showLabel={t('login.showPassword')}
            hideLabel={t('login.hidePassword')}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </FormField>

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('login.forgotPassword')}
          </Link>
        </div>

        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {submitting ? t('login.submitting') : t('login.submit')}
        </Button>

        {company ? null : (
          <p className="border-t border-border pt-5 text-center text-sm text-muted-foreground">
            {t('login.newCompany')}{' '}
            <Link
              href="/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('login.registerCompany')}
            </Link>
          </p>
        )}
      </form>
    </PublicPage>
  );
}
