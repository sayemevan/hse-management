'use client';

import { SUBSCRIPTION_STATES, type SubscriptionState } from '@hse/shared';
import { Hourglass, Inbox } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { LoadStatus } from '@/components/layout/load-status';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useLoad } from '@/modules/app/use-load';
import { SubscriptionStateBadge } from '@/modules/billing/status-badges';

import { platformPaymentsService } from './platform-payments.service';
import { usePlatformDate } from './use-platform-date';

const ALL = 'all';

function parseState(value: string | null): SubscriptionState | null {
  return SUBSCRIPTION_STATES.find((state) => state === value) ?? null;
}

const loadLastCheck = () => platformPaymentsService.lastLifecycleRun();

/** Every company's subscription, the ones needing attention first (PLT-14 FR-7, FR-8). */
export function SubscriptionsOverviewScreen() {
  const t = useTranslations('platformSubscriptions');
  const tp = useTranslations('subscription');
  const formatDate = usePlatformDate();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = parseState(params.get('state'));
  const load = useCallback(() => platformPaymentsService.subscriptions(state), [state]);
  const loaded = useLoad(load, state ?? ALL);
  const lastCheck = useLoad(loadLastCheck, 'jobs');

  const deadlineLabel = (value: SubscriptionState) =>
    value === 'trial'
      ? tp('trialEnds')
      : value === 'active'
        ? tp('periodEnds')
        : value === 'grace'
          ? tp('graceEnds')
          : tp('readOnlySince');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
        {lastCheck.status === 'ready' ? (
          <p className="text-sm text-muted-foreground">
            {lastCheck.value?.lastRunAt
              ? t('lastChecked', { date: formatDate(lastCheck.value.lastRunAt) })
              : t('neverChecked')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:max-w-xs">
        <label htmlFor="state-filter" className="text-sm font-medium">
          {t('filterLabel')}
        </label>
        <Select
          id="state-filter"
          value={state ?? ALL}
          onChange={(event) => {
            const next = parseState(event.target.value);
            router.push(next ? `${pathname}?state=${next}` : pathname);
          }}
        >
          <option value={ALL}>{t('allStates')}</option>
          {SUBSCRIPTION_STATES.map((option) => (
            <option key={option} value={option}>
              {tp(`state.${option}`)}
            </option>
          ))}
        </Select>
      </div>

      {loaded.status !== 'ready' ? (
        <LoadStatus
          error={loaded.status === 'error' ? loaded.error : undefined}
          onRetry={loaded.reload}
        />
      ) : loaded.value.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Inbox aria-hidden className="size-10 text-muted-foreground" />
          <p className="text-muted-foreground">{t('empty')}</p>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {loaded.value.map((item) => (
            <li
              key={item.companySlug}
              className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4 shadow-sm"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="font-semibold">
                  <bdi>{item.companyName}</bdi>
                </span>
                <SubscriptionStateBadge state={item.state} />
              </span>
              <span className="text-sm text-muted-foreground">
                <bdi dir="ltr">{item.companySlug}</bdi>
              </span>
              <span className="mt-1 text-sm">
                {item.billingCycle
                  ? t('planCycle', {
                      plan: item.planName,
                      cycle: tp(`pay.cycles.${item.billingCycle}`),
                    })
                  : item.planName}
              </span>
              <span className="text-sm">
                {t('deadlineLine', {
                  label: deadlineLabel(item.state),
                  date: formatDate(item.state === 'read_only' ? item.readOnlySince : item.deadline),
                })}
              </span>
              {item.paymentPendingId ? (
                <Link
                  href={`/platform/payments/${item.paymentPendingId}`}
                  className="mt-1 inline-flex min-h-10 items-center gap-2 self-start font-medium text-primary underline-offset-4 hover:underline"
                >
                  <Hourglass aria-hidden className="size-4" />
                  {t('reviewPending')}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
