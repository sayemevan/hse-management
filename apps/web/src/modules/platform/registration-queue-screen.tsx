'use client';

import { REGISTRATION_STATUSES, type RegistrationStatus } from '@hse/shared';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';

import {
  platformRegistrationsService,
  type RegistrationPage,
} from './platform-registrations.service';
import { RegistrationStatusBadge } from './registration-status-badge';
import { usePlatformDate } from './use-platform-date';
import { planName, usePlans } from './use-plans';

const ALL = 'all';
const DEFAULT_STATUS: RegistrationStatus = 'submitted';

function parseStatus(value: string | null): RegistrationStatus | null {
  if (value === ALL) return null;
  return REGISTRATION_STATUSES.find((status) => status === value) ?? DEFAULT_STATUS;
}

/** Registration queue (US-011.3): submitted applications oldest first, filterable by status. */
export function RegistrationQueueScreen() {
  const t = useTranslations('platformRegistrations');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const formatDate = usePlatformDate();
  const plans = usePlans();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = parseStatus(params.get('status'));
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [result, setResult] = useState<{ key: string; page: RegistrationPage } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const key = `${status ?? ALL}:${page}`;

  useEffect(() => {
    const effect = { cancelled: false };
    platformRegistrationsService.list(status, page).then(
      (loaded) => {
        if (!effect.cancelled) setResult({ key, page: loaded });
      },
      (loadError: unknown) => {
        if (!effect.cancelled) setError({ key, message: errorMessage(loadError) });
      },
    );
    return () => {
      effect.cancelled = true;
    };
  }, [status, page, key, errorMessage]);

  const navigate = (nextStatus: RegistrationStatus | null, nextPage: number) => {
    const query = new URLSearchParams();
    query.set('status', nextStatus ?? ALL);
    if (nextPage > 1) query.set('page', String(nextPage));
    router.push(`${pathname}?${query}`);
  };

  const current = result?.key === key ? result.page : null;
  const currentError = error?.key === key ? error.message : null;
  const loading = !current && !currentError;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="flex flex-col gap-2 sm:max-w-xs">
        <label htmlFor="status-filter" className="text-sm font-medium">
          {t('filterLabel')}
        </label>
        <Select
          id="status-filter"
          value={status ?? ALL}
          onChange={(event) => {
            navigate(parseStatus(event.target.value), 1);
          }}
        >
          {REGISTRATION_STATUSES.map((option) => (
            <option key={option} value={option}>
              {t(`status.${option}`)}
            </option>
          ))}
          <option value={ALL}>{t('allStatuses')}</option>
        </Select>
      </div>

      {currentError ? <Alert tone="danger">{currentError}</Alert> : null}

      {loading ? (
        <div role="status" className="flex items-center gap-3 text-muted-foreground">
          <Spinner />
          <span>{tc('loading')}</span>
        </div>
      ) : null}

      {current?.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Inbox aria-hidden className="size-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            {status === 'submitted' ? t('emptySubmitted') : t('empty')}
          </p>
        </Card>
      ) : null}

      {current && current.items.length > 0 ? (
        <>
          {/* Phones: one card per application. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {current.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/platform/registrations/${item.id}`}
                  className="block rounded-xl border border-border bg-background p-4 shadow-sm hover:bg-muted"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-semibold">
                      <bdi>{item.companyName}</bdi>
                    </span>
                    <RegistrationStatusBadge status={item.status} />
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    <bdi dir="ltr">{item.slug}</bdi>
                  </span>
                  <span className="mt-2 block text-sm">
                    <bdi>{item.applicantName}</bdi>
                  </span>
                  <span className="block text-sm break-all text-muted-foreground">
                    <bdi dir="ltr">{item.applicantEmail}</bdi>
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {t('submittedAt', { date: formatDate(item.submittedAt ?? item.createdAt) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* Larger screens: a table. */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-background md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted text-start text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t('columns.company')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t('columns.applicant')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t('columns.plan')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t('columns.submitted')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t('columns.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.items.map((item) => (
                  <tr key={item.id} className="border-t border-border hover:bg-muted">
                    <td className="px-4 py-3">
                      <Link
                        href={`/platform/registrations/${item.id}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        <bdi>{item.companyName}</bdi>
                      </Link>
                      <span className="block text-muted-foreground">
                        <bdi dir="ltr">{item.slug}</bdi>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <bdi>{item.applicantName}</bdi>
                      <span className="block text-muted-foreground">
                        <bdi dir="ltr">{item.applicantEmail}</bdi>
                      </span>
                    </td>
                    <td className="px-4 py-3">{planName(plans, item.planCode)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDate(item.submittedAt ?? item.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <RegistrationStatusBadge status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {current.meta.totalPages > 1 ? (
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
                {t('pageOf', { page, total: current.meta.totalPages })}
              </span>
              <Button
                variant="secondary"
                disabled={page >= current.meta.totalPages}
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
      ) : null}
    </div>
  );
}
