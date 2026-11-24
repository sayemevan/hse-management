'use client';

import { TRIAL_BANNER_DAYS } from '@hse/shared';
import { CircleAlert, Hourglass, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useAuth } from '@/modules/auth/auth-provider';
import { hasPermission } from '@/modules/auth/require-permission';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { cn } from '@/utils/cn';

import { useSubscriptionState } from './use-subscription-state';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The subscription banner under the header on every company page (PLT-11 FR-6): trial ending,
 * grace, read-only, or payment under review. Icon and text, never colour alone.
 */
export function SubscriptionBanner() {
  const t = useTranslations('subscriptionBanner');
  const { user } = useAuth();
  const { date } = useDateFormat();
  const subscription = useSubscriptionState();
  // Read once per mount: the banner only needs day precision.
  const [now] = useState(() => Date.now());
  if (!subscription || !user) return null;

  const canPay = hasPermission(user, 'subscription.pay');
  const { state, endsAt, paymentUnderReview } = subscription;
  const trialEndingSoon =
    state === 'trial' && endsAt !== null && endsAt - now <= TRIAL_BANNER_DAYS * DAY_MS;

  let message: string | null = null;
  let tone: 'warning' | 'danger' | 'info' = 'warning';
  if (paymentUnderReview && state !== 'active') {
    message = t('underReview');
    tone = 'info';
  } else if (state === 'read_only') {
    message = t('readOnly');
    tone = 'danger';
  } else if (state === 'grace') {
    message = t('grace', { date: date(endsAt) });
  } else if (trialEndingSoon) {
    message = t('trialEnding', { date: date(endsAt) });
  }
  if (!message) return null;

  const Icon = tone === 'danger' ? CircleAlert : tone === 'info' ? Hourglass : TriangleAlert;
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={cn(
        'border-b',
        tone === 'danger' && 'border-danger/30 bg-danger-surface text-danger-foreground',
        tone === 'warning' && 'border-warning/40 bg-warning-surface text-warning-foreground',
        tone === 'info' && 'border-info/30 bg-info-surface text-info-foreground',
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2">
          <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span>{message}</span>
        </p>
        {canPay && !paymentUnderReview ? (
          <Link
            href="/settings/subscription"
            className="inline-flex min-h-10 shrink-0 items-center font-semibold underline underline-offset-4 ps-7 sm:ps-0"
          >
            {t('pay')}
          </Link>
        ) : null}
        {!canPay && state === 'read_only' ? (
          <span className="ps-7 sm:ps-0">{t('contactAdmin')}</span>
        ) : null}
      </div>
    </div>
  );
}
