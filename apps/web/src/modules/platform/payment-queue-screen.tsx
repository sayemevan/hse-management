'use client';

import { PAYMENT_STATUSES, type PaymentStatus } from '@hse/shared';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { LoadStatus } from '@/components/layout/load-status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useLoad } from '@/modules/app/use-load';
import { useMoney } from '@/modules/billing/money';
import { PaymentStatusBadge } from '@/modules/billing/status-badges';

import { platformPaymentsService } from './platform-payments.service';
import { usePlatformDate } from './use-platform-date';

function parseStatus(value: string | null): PaymentStatus {
  return PAYMENT_STATUSES.find((status) => status === value) ?? 'pending';
}

/** Payments queue (PLT-14 FR-1): pending proofs oldest first, other statuses on request. */
export function PaymentQueueScreen() {
  const t = useTranslations('platformPayments');
  const tp = useTranslations('subscription');
  const formatDate = usePlatformDate();
  const money = useMoney();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = parseStatus(params.get('status'));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const load = useCallback(() => platformPaymentsService.list(status, page), [status, page]);
  const loaded = useLoad(load, `${status}:${String(page)}`);

  const navigate = (nextStatus: PaymentStatus, nextPage: number) => {
    const query = new URLSearchParams({ status: nextStatus });
    if (nextPage > 1) query.set('page', String(nextPage));
    router.push(`${pathname}?${query}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="flex flex-col gap-2 sm:max-w-xs">
        <label htmlFor="payment-status" className="text-sm font-medium">
          {t('filterLabel')}
        </label>
        <Select
          id="payment-status"
          value={status}
          onChange={(event) => {
            navigate(parseStatus(event.target.value), 1);
          }}
        >
          {PAYMENT_STATUSES.map((option) => (
            <option key={option} value={option}>
              {tp(`paymentStatus.${option}`)}
            </option>
          ))}
        </Select>
      </div>

      {loaded.status !== 'ready' ? (
        <LoadStatus
          error={loaded.status === 'error' ? loaded.error : undefined}
          onRetry={loaded.reload}
        />
      ) : loaded.value.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Inbox aria-hidden className="size-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            {status === 'pending' ? t('emptyPending') : t('empty')}
          </p>
        </Card>
      ) : (
        <>
          {status === 'pending' ? (
            <p className="text-sm text-muted-foreground">
              {t('pendingCount', { count: loaded.value.pendingCount })}
            </p>
          ) : null}
          <ul className="grid gap-3 md:grid-cols-2">
            {loaded.value.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/platform/payments/${item.id}`}
                  className="block h-full rounded-xl border border-border bg-background p-4 shadow-sm hover:bg-muted"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-semibold">
                      <bdi>{item.companyName}</bdi>
                    </span>
                    <PaymentStatusBadge status={item.status} />
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    <bdi dir="ltr">{item.companySlug}</bdi>
                  </span>
                  <span className="mt-2 block font-medium">{money(item.amount)}</span>
                  <span className="block text-sm">
                    {t('planCycle', {
                      plan: item.planName,
                      cycle: tp(`pay.cycles.${item.billingCycle}`),
                    })}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {t('submittedAt', { date: formatDate(item.submittedAt) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {loaded.value.meta.totalPages > 1 ? (
            <nav aria-label={t('pagination')} className="flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => {
                  navigate(status, page - 1);
                }}
              >
                <ChevronLeft aria-hidden className="size-5 rtl:-scale-x-100" />
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('pageOf', { page, total: loaded.value.meta.totalPages })}
              </span>
              <Button
                variant="secondary"
                disabled={page >= loaded.value.meta.totalPages}
                onClick={() => {
                  navigate(status, page + 1);
                }}
              >
                {t('next')}
                <ChevronRight aria-hidden className="size-5 rtl:-scale-x-100" />
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
