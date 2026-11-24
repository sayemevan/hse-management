'use client';

import { EMAIL_MAX_LENGTH } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';
import { z } from 'zod';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useLanguage } from '@/modules/i18n/use-language';

import { registrationService } from './registration.service';

const emailFormat = z.email();

/**
 * Requests a new verification link (US-011.2). The API answers the same way whether or not
 * an application waits for the address, so the confirmation never reveals accounts.
 * With `fixedEmail`, only the button is shown.
 */
export function ResendLinkForm({
  fixedEmail,
  submitLabel,
}: {
  fixedEmail?: string | null;
  submitLabel: string;
}) {
  const t = useTranslations('registration.resend');
  const tc = useTranslations('common');
  const { language } = useLanguage();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = (fixedEmail ?? email).trim();
    setError(null);
    setSent(false);
    if (!emailFormat.safeParse(address).success) {
      setFieldError(t('emailInvalid'));
      return;
    }
    setFieldError(null);
    setSending(true);
    try {
      await registrationService.resendVerification(address, language);
      setSent(true);
    } catch (sendError) {
      setError(errorMessage(sendError));
    } finally {
      setSending(false);
    }
  };

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      {sent ? <Alert tone="success">{t('sent')}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {fixedEmail ? null : (
        <FormField
          id="resend-email"
          label={t('email')}
          required
          requiredLabel={tc('required')}
          error={fieldError}
        >
          <Input
            id="resend-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            maxLength={EMAIL_MAX_LENGTH}
            value={email}
            invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? 'resend-email-error' : undefined}
            required
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </FormField>
      )}
      <Button
        type="submit"
        variant={fixedEmail ? 'secondary' : 'primary'}
        fullWidth
        disabled={sending}
      >
        {sending ? <Spinner /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
