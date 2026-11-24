'use client';

import { PASSWORD_RULES } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/** Issue messages the shared Zod contracts produce (`packages/shared`), translated under `validation`. */
const SHARED_ISSUE_KEYS = new Set([
  'invalidPhone',
  'termsRequired',
  'planUnavailable',
  'invalidSlug',
  'invalidCountry',
  'invalidTimeZone',
  'phoneConfirmationRequired',
]);
const PASSWORD_ISSUE_KEYS = new Set<string>([...PASSWORD_RULES, 'maxLength']);
const SLUG_REASONS = new Set(['invalid', 'reserved', 'taken']);

export const REGISTRATION_FIELDS = [
  'companyName',
  'slug',
  'countryCode',
  'city',
  'timeZone',
  'defaultLanguage',
  'applicantName',
  'applicantEmail',
  'applicantPhone',
  'password',
  'passwordConfirm',
  'planCode',
  'termsAccepted',
  'turnstileToken',
] as const;
export type RegistrationField = (typeof REGISTRATION_FIELDS)[number];

export function isRegistrationField(value: string): value is RegistrationField {
  return (REGISTRATION_FIELDS as readonly string[]).includes(value);
}

/**
 * Translates one field-level issue (from client-side validation or the API's `details`).
 * Shared contract keys get their own text; Zod's generic issues (too short, too long…) fall
 * back to a field-specific explanation, so English Zod messages are never shown.
 */
export function useFieldMessage(): (field: RegistrationField, message: string) => string {
  const t = useTranslations();
  return useCallback(
    (field, message) => {
      if (field === 'slug' && SLUG_REASONS.has(message)) {
        return t(`registration.slugStatus.${message as 'taken'}`);
      }
      if (field === 'password' && PASSWORD_ISSUE_KEYS.has(message)) {
        return t(`validation.passwordRules.${message as 'minLength'}`);
      }
      if (SHARED_ISSUE_KEYS.has(message)) return t(`validation.${message as 'invalidPhone'}`);
      return t(`registration.fieldErrors.${field}`);
    },
    [t],
  );
}
