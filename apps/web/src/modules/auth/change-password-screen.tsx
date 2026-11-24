'use client';

import { evaluatePassword, newPasswordSchema, PASSWORD_POLICY, PASSWORD_RULES } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';

import { authService } from './auth.service';
import { PasswordChecklist } from './password-checklist';

interface FieldErrors {
  current?: string;
  next?: string;
  confirm?: string;
}

/** Change password (US-005). The server enforces the same rules; this form gives live feedback. */
export function ChangePasswordScreen() {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleLabels = { showLabel: t('login.showPassword'), hideLabel: t('login.hidePassword') };

  const validate = (): FieldErrors => {
    const found: FieldErrors = {};
    if (!current) found.current = t('changePassword.currentRequired');
    if (!newPasswordSchema.safeParse(next).success) {
      const results = evaluatePassword(next);
      const firstUnmet = PASSWORD_RULES.find((rule) => !results[rule]);
      found.next = t(`changePassword.rules.${firstUnmet ?? 'maxLength'}`);
    }
    if (confirm !== next) found.confirm = t('changePassword.mismatch');
    return found;
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFormError(null);
    setSuccess(false);
    if (found.current || found.next || found.confirm) return;

    setSubmitting(true);
    try {
      await authService.changePassword({ currentPassword: current, newPassword: next });
      setSuccess(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('changePassword.title')}</h1>
        <p className="text-muted-foreground">{t('changePassword.intro')}</p>
      </div>

      <Card className="max-w-lg">
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          className="flex flex-col gap-5"
        >
          {success ? <Alert tone="success">{t('changePassword.success')}</Alert> : null}
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <p className="text-sm text-muted-foreground">{t('common.requiredHint')}</p>

          <FormField
            id="current-password"
            label={t('changePassword.current')}
            required
            requiredLabel={t('common.required')}
            error={errors.current}
          >
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              maxLength={PASSWORD_POLICY.maxLength}
              value={current}
              invalid={Boolean(errors.current)}
              aria-describedby={errors.current ? 'current-password-error' : undefined}
              required
              {...toggleLabels}
              onChange={(event) => {
                setCurrent(event.target.value);
              }}
            />
          </FormField>

          <FormField
            id="new-password"
            label={t('changePassword.new')}
            required
            requiredLabel={t('common.required')}
            error={errors.next}
            hint={<PasswordChecklist id="new-password-rules" password={next} />}
          >
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              maxLength={PASSWORD_POLICY.maxLength + 1}
              value={next}
              invalid={Boolean(errors.next)}
              aria-describedby={
                errors.next ? 'new-password-rules new-password-error' : 'new-password-rules'
              }
              required
              {...toggleLabels}
              onChange={(event) => {
                setNext(event.target.value);
              }}
            />
          </FormField>

          <FormField
            id="confirm-password"
            label={t('changePassword.confirm')}
            required
            requiredLabel={t('common.required')}
            error={errors.confirm}
          >
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              maxLength={PASSWORD_POLICY.maxLength + 1}
              value={confirm}
              invalid={Boolean(errors.confirm)}
              aria-describedby={errors.confirm ? 'confirm-password-error' : undefined}
              required
              {...toggleLabels}
              onChange={(event) => {
                setConfirm(event.target.value);
              }}
            />
          </FormField>

          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? <Spinner /> : null}
            {submitting ? t('changePassword.submitting') : t('changePassword.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
