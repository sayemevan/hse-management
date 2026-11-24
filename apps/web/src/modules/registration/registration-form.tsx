'use client';

import {
  DEFAULT_TIME_ZONE_BY_COUNTRY,
  EMAIL_MAX_LENGTH,
  ErrorCode,
  type Language,
  LANGUAGES,
  PASSWORD_POLICY,
  type PlanDto,
  REGISTRATION_LIMITS,
  registrationRequestSchema,
  resubmissionRequestSchema,
  type ValidationIssue,
} from '@hse/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, type SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { PasswordChecklist } from '@/modules/auth/password-checklist';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useLanguage } from '@/modules/i18n/use-language';
import { ApiClientError } from '@/services/api-client';

import { countryOptions, timeZoneOptions } from './location-options';
import { PlanPicker } from './plan-picker';
import { registrationService } from './registration.service';
import { SlugField, suggestSlug } from './slug-field';
import { type TurnstileHandle, TurnstileWidget } from './turnstile-widget';
import {
  isRegistrationField,
  REGISTRATION_FIELDS,
  type RegistrationField,
  useFieldMessage,
} from './use-field-message';

export interface RegistrationFormValues {
  companyName: string;
  slug: string;
  countryCode: string;
  city: string;
  timeZone: string;
  /** null: follows the page language until the applicant picks one. */
  defaultLanguage: Language | null;
  applicantName: string;
  applicantEmail: string;
  applicantPhone: string;
  password: string;
  passwordConfirm: string;
  planCode: string;
  termsAccepted: boolean;
}

export type SubmittedValues = Omit<RegistrationFormValues, 'defaultLanguage'> & {
  defaultLanguage: Language;
};

export interface RegistrationSubmission {
  values: SubmittedValues;
  turnstileToken: string;
  applicantLanguage: Language;
}

type FieldErrors = Partial<Record<RegistrationField, string>>;

export function emptyRegistrationValues(): RegistrationFormValues {
  return {
    companyName: '',
    slug: '',
    countryCode: 'SA',
    city: '',
    timeZone: DEFAULT_TIME_ZONE_BY_COUNTRY.SA ?? 'Asia/Riyadh',
    defaultLanguage: null,
    applicantName: '',
    applicantEmail: '',
    applicantPhone: '',
    password: '',
    passwordConfirm: '',
    planCode: '',
    termsAccepted: false,
  };
}

const resubmissionFieldsSchema = resubmissionRequestSchema.omit({ token: true });

/**
 * The registration form (US-011.1), reused for resubmission (US-011.5) with the email
 * read-only and the password optional. Validates with the shared contracts before sending,
 * and maps the API's field-level `details` back onto the fields.
 */
export function RegistrationForm({
  mode,
  initial,
  ownSlug,
  notice,
  onSubmit,
}: {
  mode: 'register' | 'resubmit';
  initial: RegistrationFormValues;
  ownSlug?: string;
  notice?: ReactNode;
  onSubmit: (submission: RegistrationSubmission) => Promise<void>;
}) {
  const t = useTranslations('registration');
  const tc = useTranslations('common');
  const tl = useTranslations('language');
  const locale = useLocale();
  const { language } = useLanguage();
  const errorMessage = useErrorMessage();
  const fieldMessage = useFieldMessage();
  const resubmit = mode === 'resubmit';

  const [values, setValues] = useState(initial);
  const [slugEdited, setSlugEdited] = useState(resubmit);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [botCheckUnavailable, setBotCheckUnavailable] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [plansError, setPlansError] = useState(false);
  const [plansAttempt, setPlansAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    registrationService.listPlans(language, controller.signal).then(
      (list) => {
        setPlans(list);
        setPlansError(false);
      },
      () => {
        if (!controller.signal.aborted) setPlansError(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [language, plansAttempt]);

  const countries = useMemo(() => countryOptions(locale), [locale]);
  const timeZones = useMemo(() => timeZoneOptions(values.timeZone), [values.timeZone]);

  const set = <K extends keyof RegistrationFormValues>(
    key: K,
    value: RegistrationFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    const field: RegistrationField = key;
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const issuesToErrors = (issues: readonly ValidationIssue[]): FieldErrors => {
    const errors: FieldErrors = {};
    for (const issue of issues) {
      const field = issue.path.split('.')[0] ?? '';
      if (isRegistrationField(field) && !errors[field]) {
        errors[field] = fieldMessage(field, issue.message);
      }
    }
    return errors;
  };

  const validate = (token: string): FieldErrors => {
    const common = {
      companyName: values.companyName,
      slug: values.slug,
      countryCode: values.countryCode,
      city: values.city,
      timeZone: values.timeZone,
      defaultLanguage: values.defaultLanguage ?? language,
      applicantName: values.applicantName,
      applicantPhone: values.applicantPhone,
      planCode: values.planCode,
      applicantLanguage: language,
      turnstileToken: token,
    };
    const result = resubmit
      ? resubmissionFieldsSchema.safeParse({ ...common, password: values.password || undefined })
      : registrationRequestSchema.safeParse({
          ...common,
          applicantEmail: values.applicantEmail,
          password: values.password,
          termsAccepted: values.termsAccepted,
        });
    const errors = result.success
      ? {}
      : issuesToErrors(
          result.error.issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        );
    if ((values.password || !resubmit) && values.password !== values.passwordConfirm) {
      errors.passwordConfirm ??= t('fieldErrors.passwordConfirm');
    }
    return errors;
  };

  const focusFirstError = (errors: FieldErrors) => {
    const first = REGISTRATION_FIELDS.find((field) => errors[field]);
    if (!first) return;
    const target =
      first === 'planCode' || first === 'turnstileToken'
        ? document.getElementById(`${first}-error`)
        : document.getElementById(first);
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const errors = validate(turnstileToken ?? '');
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError(t('formInvalid'));
      focusFirstError(errors);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        values: { ...values, defaultLanguage: values.defaultLanguage ?? language },
        turnstileToken: turnstileToken ?? '',
        applicantLanguage: language,
      });
    } catch (error) {
      const serverErrors =
        error instanceof ApiClientError ? issuesToErrors(error.details) : ({} as FieldErrors);
      setFieldErrors(serverErrors);
      // After the render that shows the messages: the first field, or the summary at the top.
      requestAnimationFrame(() => {
        if (Object.keys(serverErrors).length > 0) focusFirstError(serverErrors);
        else formErrorRef.current?.scrollIntoView({ block: 'center' });
      });
      setFormError(
        Object.keys(serverErrors).length > 0 ||
          (error instanceof ApiClientError && error.code === ErrorCode.VALIDATION_FAILED)
          ? t('formInvalid')
          : errorMessage(error),
      );
      setSubmitting(false);
    } finally {
      // Turnstile tokens are single use; every attempt needs a new one.
      turnstile.current?.reset();
    }
  };

  const textField = (
    field: 'companyName' | 'city' | 'applicantName',
    options: { autoComplete: string; maxLength: number },
  ) => (
    <FormField
      id={field}
      label={t(field)}
      required
      requiredLabel={tc('required')}
      error={fieldErrors[field]}
    >
      <Input
        id={field}
        name={field}
        autoComplete={options.autoComplete}
        maxLength={options.maxLength}
        value={values[field]}
        invalid={Boolean(fieldErrors[field])}
        aria-describedby={fieldErrors[field] ? `${field}-error` : undefined}
        required
        onChange={(event) => {
          const next = event.target.value;
          set(field, next);
          if (field === 'companyName' && !slugEdited) set('slug', suggestSlug(next));
        }}
      />
    </FormField>
  );

  const passwordFields = () => (
    <>
      <FormField
        id="password"
        label={resubmit ? t('newPassword') : t('password')}
        required={!resubmit}
        requiredLabel={tc('required')}
        error={fieldErrors.password}
        hint={
          <PasswordChecklist
            id="password-rules"
            password={values.password}
            title={t('passwordRulesTitle')}
          />
        }
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          maxLength={PASSWORD_POLICY.maxLength}
          value={values.password}
          invalid={Boolean(fieldErrors.password)}
          aria-describedby={
            fieldErrors.password ? 'password-rules password-error' : 'password-rules'
          }
          required={!resubmit}
          showLabel={t('showPassword')}
          hideLabel={t('hidePassword')}
          onChange={(event) => {
            set('password', event.target.value);
          }}
        />
      </FormField>
      <FormField
        id="passwordConfirm"
        label={t('passwordConfirm')}
        required={!resubmit}
        requiredLabel={tc('required')}
        error={fieldErrors.passwordConfirm}
      >
        <PasswordInput
          id="passwordConfirm"
          name="passwordConfirm"
          autoComplete="new-password"
          maxLength={PASSWORD_POLICY.maxLength}
          value={values.passwordConfirm}
          invalid={Boolean(fieldErrors.passwordConfirm)}
          aria-describedby={fieldErrors.passwordConfirm ? 'passwordConfirm-error' : undefined}
          required={!resubmit}
          showLabel={t('showPassword')}
          hideLabel={t('hidePassword')}
          onChange={(event) => {
            set('passwordConfirm', event.target.value);
          }}
        />
      </FormField>
    </>
  );

  const sectionClass = 'flex min-w-0 flex-col gap-5';
  const legendClass = 'mb-5 w-full border-t border-border pt-6 text-lg font-semibold';

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      {notice}
      <p className="text-sm text-muted-foreground">{tc('requiredHint')}</p>
      <div ref={formErrorRef} className="empty:hidden">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
      </div>

      {/* ---- Company ---------------------------------------------------------------- */}
      <fieldset className={sectionClass}>
        <legend className="mb-5 text-lg font-semibold">{t('companySection')}</legend>
        {textField('companyName', {
          autoComplete: 'organization',
          maxLength: REGISTRATION_LIMITS.companyNameMax,
        })}
        <SlugField
          value={values.slug}
          ownSlug={ownSlug}
          error={fieldErrors.slug}
          onChange={(next) => {
            setSlugEdited(true);
            set('slug', next);
          }}
        />
        <FormField
          id="countryCode"
          label={t('country')}
          required
          requiredLabel={tc('required')}
          error={fieldErrors.countryCode}
        >
          <Select
            id="countryCode"
            name="countryCode"
            autoComplete="country"
            value={values.countryCode}
            invalid={Boolean(fieldErrors.countryCode)}
            aria-describedby={fieldErrors.countryCode ? 'countryCode-error' : undefined}
            onChange={(event) => {
              const code = event.target.value;
              set('countryCode', code);
              const zone = DEFAULT_TIME_ZONE_BY_COUNTRY[code];
              if (zone) set('timeZone', zone);
            }}
          >
            <optgroup label={t('countryGroupGcc')}>
              {countries.gcc.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('countryGroupOther')}>
              {countries.others.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </FormField>
        {textField('city', {
          autoComplete: 'address-level2',
          maxLength: REGISTRATION_LIMITS.cityMax,
        })}
        <FormField
          id="timeZone"
          label={t('timeZone')}
          required
          requiredLabel={tc('required')}
          error={fieldErrors.timeZone}
          hint={<p className="text-sm text-muted-foreground">{t('timeZoneHint')}</p>}
        >
          <Select
            id="timeZone"
            name="timeZone"
            dir="ltr"
            value={values.timeZone}
            invalid={Boolean(fieldErrors.timeZone)}
            aria-describedby={fieldErrors.timeZone ? 'timeZone-error' : undefined}
            onChange={(event) => {
              set('timeZone', event.target.value);
            }}
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id="defaultLanguage"
          label={t('defaultLanguage')}
          required
          requiredLabel={tc('required')}
          error={fieldErrors.defaultLanguage}
          hint={<p className="text-sm text-muted-foreground">{t('defaultLanguageHint')}</p>}
        >
          <Select
            id="defaultLanguage"
            name="defaultLanguage"
            value={values.defaultLanguage ?? language}
            onChange={(event) => {
              set('defaultLanguage', event.target.value as Language);
            }}
          >
            {LANGUAGES.map((option) => (
              <option key={option} value={option} lang={option}>
                {tl(option)}
              </option>
            ))}
          </Select>
        </FormField>
      </fieldset>

      {/* ---- Administrator ------------------------------------------------------------ */}
      <fieldset className={sectionClass}>
        <legend className={legendClass}>{t('adminSection')}</legend>
        <p className="-mt-2 text-sm text-muted-foreground">{t('adminIntro')}</p>
        {textField('applicantName', {
          autoComplete: 'name',
          maxLength: REGISTRATION_LIMITS.personNameMax,
        })}
        <FormField
          id="applicantEmail"
          label={t('applicantEmail')}
          required={!resubmit}
          requiredLabel={tc('required')}
          error={fieldErrors.applicantEmail}
          hint={
            resubmit ? (
              <p id="applicantEmail-hint" className="text-sm text-muted-foreground">
                {t('emailReadOnly')}
              </p>
            ) : null
          }
        >
          <Input
            id="applicantEmail"
            name="applicantEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            maxLength={EMAIL_MAX_LENGTH}
            value={values.applicantEmail}
            readOnly={resubmit}
            className={resubmit ? 'bg-muted' : undefined}
            invalid={Boolean(fieldErrors.applicantEmail)}
            aria-describedby={
              fieldErrors.applicantEmail
                ? 'applicantEmail-error'
                : resubmit
                  ? 'applicantEmail-hint'
                  : undefined
            }
            required={!resubmit}
            onChange={(event) => {
              set('applicantEmail', event.target.value);
            }}
          />
        </FormField>
        <FormField
          id="applicantPhone"
          label={t('applicantPhone')}
          required
          requiredLabel={tc('required')}
          error={fieldErrors.applicantPhone}
          hint={
            <p id="applicantPhone-hint" className="text-sm text-muted-foreground">
              {t('phoneHint')}
            </p>
          }
        >
          <Input
            id="applicantPhone"
            name="applicantPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            maxLength={20}
            value={values.applicantPhone}
            invalid={Boolean(fieldErrors.applicantPhone)}
            aria-describedby={
              fieldErrors.applicantPhone
                ? 'applicantPhone-hint applicantPhone-error'
                : 'applicantPhone-hint'
            }
            required
            onChange={(event) => {
              set('applicantPhone', event.target.value);
            }}
          />
        </FormField>

        {resubmit ? (
          <details className="rounded-lg border border-border p-4 open:pb-5">
            <summary className="min-h-8 cursor-pointer font-medium">{t('changePassword')}</summary>
            <div className="mt-4 flex flex-col gap-5">
              <p className="text-sm text-muted-foreground">{t('changePasswordHint')}</p>
              {passwordFields()}
            </div>
          </details>
        ) : (
          passwordFields()
        )}
      </fieldset>

      {/* ---- Plan ------------------------------------------------------------------- */}
      <fieldset className={sectionClass}>
        <legend id="plan-legend" className={legendClass}>
          {t('planSection')}
          <span className="ms-1 text-danger" aria-hidden>
            *
          </span>
        </legend>
        <p className="-mt-2 text-sm text-muted-foreground">{t('planIntro')}</p>
        {plansError ? (
          <Alert tone="danger">
            <div className="flex flex-col items-start gap-2">
              <span>{t('plan.loadError')}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPlansError(false);
                  setPlansAttempt((attempt) => attempt + 1);
                }}
              >
                {tc('retry')}
              </Button>
            </div>
          </Alert>
        ) : plans === null ? (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Spinner />
            <span>{tc('loading')}</span>
          </div>
        ) : (
          <PlanPicker
            plans={plans}
            value={values.planCode}
            error={fieldErrors.planCode}
            onChange={(code) => {
              set('planCode', code);
            }}
          />
        )}
      </fieldset>

      {/* ---- Confirmation ------------------------------------------------------------- */}
      <fieldset className={sectionClass}>
        <legend className="sr-only">{t('confirmSection')}</legend>
        {resubmit ? null : (
          <Checkbox
            id="termsAccepted"
            name="termsAccepted"
            checked={values.termsAccepted}
            invalid={Boolean(fieldErrors.termsAccepted)}
            error={fieldErrors.termsAccepted}
            onChange={(event) => {
              set('termsAccepted', event.target.checked);
            }}
            label={t.rich('terms', {
              terms: (chunks) => (
                <a
                  href="/terms"
                  target="_blank"
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {chunks}
                </a>
              ),
              privacy: (chunks) => (
                <a
                  href="/privacy"
                  target="_blank"
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {chunks}
                </a>
              ),
            })}
          />
        )}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('botCheck')}</p>
          <TurnstileWidget
            ref={turnstile}
            language={language}
            onToken={(token) => {
              setTurnstileToken(token);
              if (token) {
                setFieldErrors((current) => ({ ...current, turnstileToken: undefined }));
              }
            }}
            onLoadError={() => {
              setBotCheckUnavailable(true);
            }}
          />
          {botCheckUnavailable ? <Alert tone="warning">{t('botCheckUnavailable')}</Alert> : null}
          {fieldErrors.turnstileToken ? (
            <p id="turnstileToken-error" tabIndex={-1} className="text-sm text-danger">
              {fieldErrors.turnstileToken}
            </p>
          ) : null}
        </div>
      </fieldset>

      <Button type="submit" fullWidth disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {submitting ? t('submitting') : resubmit ? t('resubmit.submit') : t('submit')}
      </Button>
    </form>
  );
}
