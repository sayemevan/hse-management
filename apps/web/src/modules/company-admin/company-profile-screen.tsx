'use client';

import {
  type CompanyProfileDto,
  DEFAULT_TIME_ZONE_BY_COUNTRY,
  ErrorCode,
  normalizePhone,
  updateCompanyRequestSchema,
} from '@hse/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useEffect, useMemo, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { LoadStatus } from '@/components/layout/load-status';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useLoad } from '@/modules/app/use-load';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { countryOptions, timeZoneOptions } from '@/modules/registration/location-options';
import { useReloadTenant } from '@/modules/tenant/tenant-provider';
import { ApiClientError } from '@/services/api-client';
import { ReadOnlyHint } from '@/modules/billing/read-only-hint';
import { useReadOnly } from '@/modules/billing/use-subscription-state';

import { companyService } from './company.service';
import { LogoSection } from './logo-section';

type Field =
  | 'name'
  | 'registrationNumber'
  | 'countryCode'
  | 'city'
  | 'address'
  | 'timeZone'
  | 'contactEmail'
  | 'contactPhone';

type Values = Record<Field, string>;

function toValues(profile: CompanyProfileDto): Values {
  return {
    name: profile.name,
    registrationNumber: profile.registrationNumber ?? '',
    countryCode: profile.countryCode ?? 'SA',
    city: profile.city ?? '',
    address: profile.address ?? '',
    timeZone: profile.timeZone,
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
  };
}

const loadInformation = () => companyService.information();

/** Settings → Company (US-012 profile, US-014 logo). The subdomain is read-only (O-29). */
export function CompanyProfileScreen() {
  const loaded = useLoad(loadInformation, 'company-profile');
  if (loaded.status !== 'ready') {
    return (
      <LoadStatus
        error={loaded.status === 'error' ? loaded.error : undefined}
        onRetry={loaded.reload}
      />
    );
  }
  // A reload (after a conflict) starts the form again from the latest version.
  return (
    <CompanyProfileForm
      key={loaded.value.profile.updatedAt}
      initial={loaded.value.profile}
      onReload={loaded.reload}
    />
  );
}

function CompanyProfileForm({
  initial,
  onReload,
}: {
  initial: CompanyProfileDto;
  onReload: () => void;
}) {
  const t = useTranslations('companySettings');
  const tr = useTranslations('registration');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const reloadTenant = useReloadTenant();
  const locale = useLocale();
  const [profile, setProfile] = useState<CompanyProfileDto>(initial);
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const timeZones = useMemo(() => timeZoneOptions(values.timeZone), [values.timeZone]);
  const load = onReload;

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(toValues(profile)),
    [profile, values],
  );

  // Unsaved-changes warning when leaving the page (US-012 UI).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  const set = (field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setSaved(false);
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = {
      ...values,
      contactPhone: normalizePhone(values.contactPhone),
      updatedAt: profile.updatedAt,
    };
    const parsed = updateCompanyRequestSchema.safeParse(request);
    const found: Partial<Record<Field, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        found[field] = t(`invalid.${field}`);
      }
    }
    setErrors(found);
    setFormError(null);
    setConflict(false);
    if (!parsed.success) return;

    setSaving(true);
    try {
      const next = await companyService.updateProfile(request);
      setProfile(next);
      setValues(toValues(next));
      setSaved(true);
      reloadTenant();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === ErrorCode.CONFLICT) setConflict(true);
      else setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const text = (field: Field, options: { required?: boolean; dir?: 'ltr'; type?: string } = {}) => (
    <FormField
      id={field}
      label={t(`fields.${field}`)}
      required={options.required}
      requiredLabel={tc('required')}
      error={errors[field]}
    >
      <Input
        id={field}
        type={options.type ?? 'text'}
        dir={options.dir}
        value={values[field]}
        invalid={Boolean(errors[field])}
        aria-describedby={errors[field] ? `${field}-error` : undefined}
        onChange={(event) => {
          set(field, event.target.value);
        }}
      />
    </FormField>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <form
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
            className="flex flex-col gap-5"
          >
            {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            {conflict ? (
              <Alert tone="warning">
                <div className="flex flex-col items-start gap-2">
                  {t('conflict')}
                  <Button variant="secondary" size="sm" onClick={load}>
                    {t('reload')}
                  </Button>
                </div>
              </Alert>
            ) : null}
            <p className="text-sm text-muted-foreground">{tc('requiredHint')}</p>

            {text('name', { required: true })}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('fields.slug')}</span>
              <bdi dir="ltr" className="rounded-lg bg-muted px-4 py-3 text-start font-medium">
                {profile.slug}
              </bdi>
              <p className="text-sm text-muted-foreground">{t('slugHint')}</p>
            </div>

            {text('registrationNumber', { dir: 'ltr' })}

            <FormField
              id="countryCode"
              label={t('fields.countryCode')}
              required
              requiredLabel={tc('required')}
            >
              <Select
                id="countryCode"
                value={values.countryCode}
                onChange={(event) => {
                  const code = event.target.value;
                  set('countryCode', code);
                  // Pre-fill the time zone from the country (O-17); it can be changed.
                  const zone = DEFAULT_TIME_ZONE_BY_COUNTRY[code];
                  if (zone) set('timeZone', zone);
                }}
              >
                <optgroup label={tr('countryGroupGcc')}>
                  {countries.gcc.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={tr('countryGroupOther')}>
                  {countries.others.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </FormField>

            {text('city', { required: true })}

            <FormField id="address" label={t('fields.address')} error={errors.address}>
              <Textarea
                id="address"
                rows={3}
                maxLength={300}
                value={values.address}
                onChange={(event) => {
                  set('address', event.target.value);
                }}
              />
            </FormField>

            <FormField
              id="timeZone"
              label={t('fields.timeZone')}
              required
              requiredLabel={tc('required')}
            >
              <Select
                id="timeZone"
                dir="ltr"
                value={values.timeZone}
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

            {text('contactEmail', { required: true, dir: 'ltr', type: 'email' })}
            {text('contactPhone', { required: true, dir: 'ltr', type: 'tel' })}

            <Button
              type="submit"
              disabled={readOnly || saving || !dirty}
              aria-describedby={readOnly ? 'profile-read-only' : undefined}
              className="self-start"
            >
              {saving ? <Spinner /> : null}
              {saving ? t('saving') : t('save')}
            </Button>
            <ReadOnlyHint id="profile-read-only" />
          </form>
        </Card>

        <LogoSection
          companyName={profile.name}
          logoUrl={profile.logoUrl}
          onChange={(logoUrl) => {
            setProfile((current) => ({ ...current, logoUrl }));
            // A logo change touches the company record: take its new version so the next
            // profile save isn't reported as a conflict. Unsaved form edits are kept.
            companyService.information().then(
              (info) => {
                setProfile((current) => ({ ...current, updatedAt: info.profile.updatedAt }));
              },
              () => undefined,
            );
          }}
        />
      </div>
    </div>
  );
}
