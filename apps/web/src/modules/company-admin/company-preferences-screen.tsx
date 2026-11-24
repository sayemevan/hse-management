'use client';

import {
  type CompanySettingsDto,
  DATE_FORMATS,
  type DateFormat,
  LANGUAGES,
  TIME_FORMATS,
  type TimeFormat,
  WEEK_DAYS,
  WEEK_STARTS,
  type WeekDay,
} from '@hse/shared';
import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type SyntheticEvent, useMemo, useState } from 'react';

import { LoadStatus } from '@/components/layout/load-status';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { authService } from '@/modules/auth/auth.service';
import { useAuth } from '@/modules/auth/auth-provider';
import { formatDateParts } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useLanguage } from '@/modules/i18n/use-language';
import { useCompany, useReloadTenant } from '@/modules/tenant/tenant-provider';
import { ApiClientError } from '@/services/api-client';
import { cn } from '@/utils/cn';
import { ReadOnlyHint } from '@/modules/billing/read-only-hint';
import { useReadOnly } from '@/modules/billing/use-subscription-state';

import { companyService } from './company.service';

/** A fixed reference date for the format examples: 25 March 2026, 14:30 UTC. */
const EXAMPLE_TIME = Date.UTC(2026, 2, 25, 14, 30);

const CHOICE_CLASS =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-muted has-[:focus-visible]:outline-2';

const loadSettings = () => companyService.settings();

/** Settings → Preferences (US-013, O-28). */
export function CompanyPreferencesScreen() {
  const settings = useLoad(loadSettings, 'company-settings');
  if (settings.status !== 'ready') {
    return (
      <LoadStatus
        error={settings.status === 'error' ? settings.error : undefined}
        onRetry={settings.reload}
      />
    );
  }
  return (
    <PreferencesForm
      key={settings.value.updatedAt}
      initial={settings.value}
      onReload={settings.reload}
    />
  );
}

function PreferencesForm({
  initial,
  onReload,
}: {
  initial: CompanySettingsDto;
  onReload: () => void;
}) {
  const t = useTranslations('preferences');
  const tl = useTranslations('language');
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const locale = useLocale().startsWith('ar') ? 'ar' : 'en';
  const company = useCompany();
  const reloadTenant = useReloadTenant();
  const { user, setUser } = useAuth();
  const { applyLanguage } = useLanguage();
  const [loaded, setLoaded] = useState<CompanySettingsDto>(initial);
  const [values, setValues] = useState<CompanySettingsDto>(initial);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // The preview shows the time the page opened, so rendering stays pure.
  const [openedAt] = useState(() => Date.now());
  const load = onReload;

  const weekdayNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    // 4 January 1970 was a Sunday (day 0).
    return WEEK_DAYS.map((day) => format.format(Date.UTC(1970, 0, 4 + day)));
  }, [locale]);

  const timeZone = user?.effectiveTimeZone ?? company?.timeZone ?? 'Asia/Riyadh';
  const example = (dateFormat: DateFormat, timeFormat: TimeFormat, withTime: boolean) =>
    formatDateParts(EXAMPLE_TIME, { dateFormat, timeFormat, timeZone: 'UTC', locale }, withTime);
  const preview = formatDateParts(
    openedAt,
    { dateFormat: values.dateFormat, timeFormat: values.timeFormat, timeZone, locale },
    true,
  );

  const update = (patch: Partial<CompanySettingsDto>) => {
    setValues((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  const toggleDay = (day: WeekDay) => {
    const has = values.workingDays.includes(day);
    update({
      workingDays: has
        ? values.workingDays.filter((item) => item !== day)
        : [...values.workingDays, day].sort((a, b) => a - b),
    });
  };

  const noWorkingDay = values.workingDays.length === 0;

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (noWorkingDay) return;
    setSaving(true);
    setFormError(null);
    try {
      const next = await companyService.updateSettings(values);
      setLoaded(next);
      setValues(next);
      setSaved(true);
      reloadTenant();
      // Users who follow the company language (and this one's date formats) update at once.
      const me = await authService.me();
      setUser(me);
      applyLanguage(me.effectiveLanguage);
    } catch (error) {
      setFormError(
        error instanceof ApiClientError && error.code === 'CONFLICT'
          ? t('conflict')
          : errorMessage(error),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      <Card className="max-w-2xl">
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          className="flex flex-col gap-6"
        >
          {saved ? <Alert tone="success">{t('saved')}</Alert> : null}
          {formError ? (
            <Alert tone="danger">
              <div className="flex flex-col items-start gap-2">
                {formError}
                <Button variant="secondary" size="sm" onClick={load}>
                  {t('reload')}
                </Button>
              </div>
            </Alert>
          ) : null}

          <div className="rounded-lg bg-muted p-4" aria-live="polite">
            <p className="text-sm text-muted-foreground">{t('preview')}</p>
            <p className="text-lg font-semibold">
              <bdi dir="ltr">{preview}</bdi>
            </p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">{t('defaultLanguage')}</legend>
            <p className="text-sm text-muted-foreground">{t('defaultLanguageHint')}</p>
            {LANGUAGES.map((option) => (
              <label key={option} className={CHOICE_CLASS}>
                <input
                  type="radio"
                  name="defaultLanguage"
                  value={option}
                  checked={values.defaultLanguage === option}
                  onChange={() => {
                    update({ defaultLanguage: option });
                  }}
                />
                <span lang={option}>{tl(option)}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">{t('dateFormat')}</legend>
            {DATE_FORMATS.map((format) => (
              <label key={format} className={CHOICE_CLASS}>
                <input
                  type="radio"
                  name="dateFormat"
                  value={format}
                  checked={values.dateFormat === format}
                  onChange={() => {
                    update({ dateFormat: format });
                  }}
                />
                <span className="flex-1">
                  <bdi dir="ltr">{format}</bdi>
                </span>
                <span className="text-sm text-muted-foreground">
                  <bdi dir="ltr">{example(format, '24h', false)}</bdi>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">{t('timeFormat')}</legend>
            {TIME_FORMATS.map((format) => (
              <label key={format} className={CHOICE_CLASS}>
                <input
                  type="radio"
                  name="timeFormat"
                  value={format}
                  checked={values.timeFormat === format}
                  onChange={() => {
                    update({ timeFormat: format });
                  }}
                />
                <span className="flex-1">{t(`timeFormats.${format}`)}</span>
                <span className="text-sm text-muted-foreground">
                  <bdi dir="ltr">{example('YYYY-MM-DD', format, true).slice(11)}</bdi>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">{t('weekStart')}</legend>
            {WEEK_STARTS.map((day) => (
              <label key={day} className={CHOICE_CLASS}>
                <input
                  type="radio"
                  name="weekStart"
                  value={day}
                  checked={values.weekStart === day}
                  onChange={() => {
                    update({ weekStart: day });
                  }}
                />
                <span>{weekdayNames[day]}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2" aria-describedby="working-days-error">
            <legend className="mb-2 font-medium">{t('workingDays')}</legend>
            <div className="flex flex-wrap gap-2">
              {WEEK_DAYS.map((day) => {
                const checked = values.workingDays.includes(day);
                return (
                  <label
                    key={day}
                    className={cn(
                      'flex min-h-12 cursor-pointer items-center gap-2 rounded-full border px-4 has-[:focus-visible]:outline-2',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => {
                        toggleDay(day);
                      }}
                    />
                    {checked ? <Check aria-hidden className="size-4" /> : null}
                    {weekdayNames[day]}
                  </label>
                );
              })}
            </div>
            {noWorkingDay ? (
              <p id="working-days-error" className="text-sm text-danger">
                {t('noWorkingDay')}
              </p>
            ) : null}
          </fieldset>

          <Button
            type="submit"
            disabled={
              readOnly ||
              saving ||
              noWorkingDay ||
              JSON.stringify(values) === JSON.stringify(loaded)
            }
            aria-describedby={readOnly ? 'preferences-read-only' : undefined}
            className="self-start"
          >
            {saving ? <Spinner /> : null}
            {saving ? t('saving') : t('save')}
          </Button>
          <ReadOnlyHint id="preferences-read-only" />
        </form>
      </Card>
    </div>
  );
}
