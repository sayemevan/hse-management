'use client';

import { evaluatePassword, newPasswordSchema, PASSWORD_POLICY, PASSWORD_RULES } from '@hse/shared';
import { useTranslations } from 'next-intl';

import { FormField } from '@/components/form/form-field';
import { PasswordInput } from '@/components/ui/password-input';

import { PasswordChecklist } from './password-checklist';

export interface NewPasswordErrors {
  password?: string;
  confirm?: string;
}

/** Checks a new password and its confirmation with the D-03 policy (the server checks again). */
export function useNewPasswordValidation() {
  const t = useTranslations('changePassword');
  return (password: string, confirm: string): NewPasswordErrors => {
    const found: NewPasswordErrors = {};
    if (!newPasswordSchema.safeParse(password).success) {
      const results = evaluatePassword(password);
      const firstUnmet = PASSWORD_RULES.find((rule) => !results[rule]);
      found.password = t(`rules.${firstUnmet ?? 'maxLength'}`);
    }
    if (confirm !== password) found.confirm = t('mismatch');
    return found;
  };
}

/**
 * New password + confirmation with the live policy checklist, shared by reset password
 * (US-003) and invitation acceptance (US-006).
 */
export function NewPasswordFields({
  password,
  confirm,
  errors,
  onPasswordChange,
  onConfirmChange,
}: {
  password: string;
  confirm: string;
  errors: NewPasswordErrors;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
}) {
  const t = useTranslations();
  const toggleLabels = { showLabel: t('login.showPassword'), hideLabel: t('login.hidePassword') };
  return (
    <>
      <FormField
        id="new-password"
        label={t('changePassword.new')}
        required
        requiredLabel={t('common.required')}
        error={errors.password}
        hint={<PasswordChecklist id="new-password-rules" password={password} />}
      >
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          maxLength={PASSWORD_POLICY.maxLength + 1}
          value={password}
          invalid={Boolean(errors.password)}
          aria-describedby={
            errors.password ? 'new-password-rules new-password-error' : 'new-password-rules'
          }
          required
          {...toggleLabels}
          onChange={(event) => {
            onPasswordChange(event.target.value);
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
            onConfirmChange(event.target.value);
          }}
        />
      </FormField>
    </>
  );
}
