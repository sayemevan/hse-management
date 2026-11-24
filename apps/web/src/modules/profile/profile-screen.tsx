'use client';

import { type Language, LANGUAGES, normalizePhone, updateMeRequestSchema } from '@hse/shared';
import { ChevronRight, KeyRound, MonitorSmartphone, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, type SyntheticEvent, useMemo, useState } from 'react';

import { FormField } from '@/components/form/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { authService } from '@/modules/auth/auth.service';
import { useAuth } from '@/modules/auth/auth-provider';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useLanguage } from '@/modules/i18n/use-language';
import { timeZoneOptions } from '@/modules/registration/location-options';
import { useCompany } from '@/modules/tenant/tenant-provider';

/** "" in a select = follow the company default (D-21). */
const DEFAULT = '';

interface Errors {
  fullName?: string;
  phone?: string;
}

/** My profile (US-007, O-27): name, phone, language and time zone. Email is read-only. */
export function ProfileScreen() {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const tl = useTranslations('language');
  const troles = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const { user, setUser } = useAuth();
  const company = useCompany();
  const { applyLanguage } = useLanguage();
  const { dateTime } = useDateFormat();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [language, setLanguage] = useState<string>(user?.preferredLanguage ?? DEFAULT);
  const [timeZone, setTimeZone] = useState<string>(user?.timeZone ?? DEFAULT);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const timeZones = useMemo(() => timeZoneOptions(timeZone), [timeZone]);

  if (!user) return null;
  const hasCompany = Boolean(company);

  const startEditing = () => {
    setFullName(user.fullName);
    setPhone(user.phone ?? '');
    setLanguage(user.preferredLanguage ?? DEFAULT);
    setTimeZone(user.timeZone ?? DEFAULT);
    setErrors({});
    setFormError(null);
    setSaved(false);
    setEditing(true);
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = {
      fullName,
      phone: phone.trim() === '' ? '' : normalizePhone(phone),
      preferredLanguage: language === DEFAULT ? null : (language as Language),
      timeZone: timeZone === DEFAULT ? null : timeZone,
    };
    const parsed = updateMeRequestSchema.safeParse(request);
    const found: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'fullName') found.fullName = t('nameInvalid');
        if (issue.path[0] === 'phone') found.phone = t('phoneInvalid');
      }
    }
    setErrors(found);
    setFormError(null);
    if (found.fullName || found.phone) return;

    setSaving(true);
    try {
      const updated = await authService.updateProfile(request);
      setUser(updated);
      applyLanguage(updated.effectiveLanguage);
      setEditing(false);
      setSaved(true);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const roleNames = user.roles.map((role) => troles(role.roleCode as 'worker')).join(', ');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground"
        >
          {user.fullName.trim().charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-2xl font-semibold">
            <bdi>{user.fullName}</bdi>
          </h1>
          <p className="text-muted-foreground">{t('title')}</p>
        </div>
      </div>

      {saved ? <Alert tone="success">{t('saved')}</Alert> : null}

      {editing ? (
        <Card className="max-w-2xl">
          <form
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
            className="flex flex-col gap-5"
          >
            <h2 className="text-lg font-semibold">{t('editTitle')}</h2>
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <FormField
              id="full-name"
              label={t('fullName')}
              required
              requiredLabel={tc('required')}
              error={errors.fullName}
            >
              <Input
                id="full-name"
                autoComplete="name"
                maxLength={100}
                value={fullName}
                invalid={Boolean(errors.fullName)}
                aria-describedby={errors.fullName ? 'full-name-error' : undefined}
                onChange={(event) => {
                  setFullName(event.target.value);
                }}
              />
            </FormField>
            <FormField
              id="phone"
              label={t('phone')}
              error={errors.phone}
              hint={<p className="text-sm text-muted-foreground">{t('phoneHint')}</p>}
            >
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                value={phone}
                invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'phone-error' : undefined}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
            </FormField>
            <FormField id="language" label={t('language')}>
              <Select
                id="language"
                value={language}
                onChange={(event) => {
                  setLanguage(event.target.value);
                }}
              >
                {hasCompany ? (
                  <option value={DEFAULT}>
                    {t('useCompanyDefault', { value: tl(company?.defaultLanguage ?? 'en') })}
                  </option>
                ) : null}
                {LANGUAGES.map((option) => (
                  <option key={option} value={option} lang={option}>
                    {tl(option)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="time-zone" label={t('timeZone')}>
              <Select
                id="time-zone"
                dir="ltr"
                value={timeZone}
                onChange={(event) => {
                  setTimeZone(event.target.value);
                }}
              >
                <option value={DEFAULT}>
                  {t('useCompanyDefault', { value: company?.timeZone ?? 'Asia/Riyadh' })}
                </option>
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                }}
              >
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{t('detailsTitle')}</h2>
            <Button variant="secondary" size="sm" onClick={startEditing}>
              <Pencil aria-hidden className="size-4" />
              {t('edit')}
            </Button>
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Detail label={t('fullName')} value={<bdi>{user.fullName}</bdi>} />
            <Detail
              label={t('email')}
              value={<bdi dir="ltr">{user.email}</bdi>}
              hint={t('emailReadOnly')}
            />
            <Detail
              label={t('phone')}
              value={user.phone ? <bdi dir="ltr">{user.phone}</bdi> : t('notSet')}
            />
            <Detail label={t('roles')} value={roleNames || t('notSet')} />
            {company ? <Detail label={t('company')} value={<bdi>{company.name}</bdi>} /> : null}
            <Detail
              label={t('language')}
              value={
                user.preferredLanguage
                  ? tl(user.preferredLanguage)
                  : t('companyDefaultValue', { value: tl(user.effectiveLanguage) })
              }
            />
            <Detail
              label={t('timeZone')}
              value={
                user.timeZone ? (
                  <bdi dir="ltr">{user.timeZone}</bdi>
                ) : (
                  t('companyDefaultValue', { value: user.effectiveTimeZone })
                )
              }
            />
            <Detail
              label={t('lastSignIn')}
              value={<bdi dir="ltr">{dateTime(user.lastLoginAt)}</bdi>}
            />
          </dl>
        </Card>
      )}

      <Card className="max-w-2xl p-2">
        <h2 className="px-3 pb-1 pt-2 text-sm font-semibold text-muted-foreground">
          {t('securityTitle')}
        </h2>
        <ul>
          {[
            { href: '/profile/change-password', label: t('changePassword'), Icon: KeyRound },
            { href: '/profile/sessions', label: t('sessions'), Icon: MonitorSmartphone },
          ].map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex min-h-14 items-center gap-3 rounded-lg px-3 hover:bg-muted"
              >
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                <span className="flex-1">{label}</span>
                <ChevronRight
                  aria-hidden
                  className="size-5 text-muted-foreground rtl:-scale-x-100"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Detail({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
