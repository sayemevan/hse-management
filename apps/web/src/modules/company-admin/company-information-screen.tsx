'use client';

import { Building2, Mail, Pencil, Phone } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useMemo } from 'react';

import { LoadStatus } from '@/components/layout/load-status';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLoad } from '@/modules/app/use-load';
import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { useDateFormat } from '@/modules/i18n/use-date-format';

import { companyService } from './company.service';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const loadInformation = () => companyService.information();

/** Company information (US-015): profile for every user, account summary for administrators. */
export function CompanyInformationScreen() {
  const t = useTranslations('companyInfo');
  const tl = useTranslations('language');
  const { user } = useAuth();
  const { date } = useDateFormat();
  const locale = useLocale();
  const loaded = useLoad(loadInformation, 'company');
  const countryName = useMemo(
    () => new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }),
    [locale],
  );

  if (loaded.status !== 'ready') {
    return (
      <LoadStatus
        error={loaded.status === 'error' ? loaded.error : undefined}
        onRetry={loaded.reload}
      />
    );
  }

  const { profile, account, subscription } = loaded.value;
  const state = subscription?.state ?? account?.subscriptionStatus ?? 'none';
  const size = (bytes: number) =>
    bytes >= GB
      ? t('gb', { value: Math.round((bytes / GB) * 10) / 10 })
      : t('mb', { value: Math.round((bytes / MB) * 10) / 10 });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {profile.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API from R2 (PLT-07)
            <img
              src={profile.logoUrl}
              alt={t('logoAlt', { company: profile.name })}
              className="size-16 rounded-lg object-contain"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-16 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            >
              <Building2 className="size-8" />
            </span>
          )}
          <h1 className="text-2xl font-semibold">
            <bdi>{profile.name}</bdi>
          </h1>
        </div>
        {hasPermission(user, 'company.edit') ? (
          <Link href="/settings/company" className={buttonVariants({ variant: 'secondary' })}>
            <Pencil aria-hidden className="size-4" />
            {t('edit')}
          </Link>
        ) : null}
      </div>

      {subscription?.state === 'trial' && subscription.endsAt ? (
        <Alert tone="info">{t('trialEnds', { date: date(subscription.endsAt) })}</Alert>
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold">{t('profileTitle')}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Item label={t('registrationNumber')} value={profile.registrationNumber} ltr />
          <Item
            label={t('country')}
            value={profile.countryCode ? (countryName.of(profile.countryCode) ?? null) : null}
          />
          <Item label={t('city')} value={profile.city} />
          <Item label={t('address')} value={profile.address} />
          <Item label={t('timeZone')} value={profile.timeZone} ltr />
          <Item label={t('language')} value={tl(profile.defaultLanguage)} />
          <Item
            label={t('contactEmail')}
            value={
              profile.contactEmail ? (
                <a
                  href={`mailto:${profile.contactEmail}`}
                  className="inline-flex min-h-10 items-center gap-2 text-primary underline-offset-4 hover:underline"
                >
                  <Mail aria-hidden className="size-4" />
                  <bdi dir="ltr">{profile.contactEmail}</bdi>
                </a>
              ) : null
            }
          />
          <Item
            label={t('contactPhone')}
            value={
              profile.contactPhone ? (
                <a
                  href={`tel:${profile.contactPhone}`}
                  className="inline-flex min-h-10 items-center gap-2 text-primary underline-offset-4 hover:underline"
                >
                  <Phone aria-hidden className="size-4" />
                  <bdi dir="ltr">{profile.contactPhone}</bdi>
                </a>
              ) : null
            }
          />
        </dl>
      </Card>

      {/* PLT-13 FR-10: every user sees the plan, its state and end date (no amounts). */}
      {!account && subscription ? (
        <Card>
          <h2 className="text-lg font-semibold">{t('subscription')}</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Item label={t('plan')} value={subscription.planName} />
            <Item
              label={t('subscription')}
              value={t(`subscriptionStatus.${subscription.state}` as 'subscriptionStatus.trial')}
            />
            <Item label={t('endsOn')} value={date(subscription.endsAt)} ltr />
          </dl>
        </Card>
      ) : null}

      {account ? (
        <Card>
          <h2 className="text-lg font-semibold">{t('accountTitle')}</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Item label={t('subdomain')} value={profile.slug} ltr />
            <Item label={t('plan')} value={account.planName || null} />
            <Item
              label={t('subscription')}
              value={t(`subscriptionStatus.${state}` as 'subscriptionStatus.trial')}
            />
            <Item
              label={state === 'trial' ? t('trialEndDate') : t('endsOn')}
              value={date(subscription?.endsAt ?? null)}
              ltr
            />
          </dl>
          {hasPermission(user, 'subscription.view') ? (
            <Link
              href="/settings/subscription"
              className="mt-4 inline-flex min-h-10 items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('manageSubscription')}
            </Link>
          ) : null}
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <Usage
              label={t('users')}
              used={account.users.used}
              limit={account.users.limit}
              text={
                account.users.limit === null
                  ? t('usersUnlimited', { used: account.users.used })
                  : t('usersOf', { used: account.users.used, limit: account.users.limit })
              }
            />
            <Usage
              label={t('storage')}
              used={account.storage.usedBytes}
              limit={account.storage.limitBytes}
              text={t('storageOf', {
                used: size(account.storage.usedBytes),
                limit: size(account.storage.limitBytes),
              })}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Item({ label, value, ltr }: { label: string; value: ReactNode; ltr?: boolean }) {
  const t = useTranslations('companyInfo');
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">
        {value === null || value === '' ? (
          <span className="text-muted-foreground">{t('notSet')}</span>
        ) : ltr ? (
          <bdi dir="ltr">{value}</bdi>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/** A usage bar with the value in text too (not colour only, US-015 UI). */
function Usage({
  label,
  used,
  limit,
  text,
}: {
  label: string;
  used: number;
  limit: number | null;
  text: string;
}) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{text}</span>
      </div>
      {limit ? (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={text}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={percent >= 90 ? 'h-full bg-warning' : 'h-full bg-primary'}
            style={{ inlineSize: `${String(percent)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
