'use client';

import type { MyInspectionsPageDto } from '@hse/shared';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/modules/auth/auth-provider';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { useSync } from '@/modules/offline/sync-provider';
import { cn } from '@/utils/cn';

import {
  captureHref,
  type InspectionCopy,
  keepFromServer,
  listCopies,
  refreshTemplatePack,
  START_ROUTE,
} from './inspection-offline';
import { InspectionCard, InspectionStatusChip, NotSyncedChip, useTemplateName } from './inspection-ui';
import { inspectionsService } from './inspections.service';

type Tab = 'assigned' | 'in_progress' | 'to_review';
const TABS: readonly Tab[] = ['assigned', 'in_progress', 'to_review'];
/** Inspections kept on the device for offline capture when the list loads online. */
const KEEP_MAX = 20;

/** US-033: My inspections (works offline: the device's own inspections and the last copies). */
export function MyInspectionsScreen() {
  const t = useTranslations('inspections.mine');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const params = useSearchParams();
  const { user } = useAuth();
  const { online, items: outbox } = useSync();
  const name = useTemplateName();
  const initial = params.get('tab');
  const [tab, setTab] = useState<Tab>(TABS.includes(initial as Tab) ? (initial as Tab) : 'assigned');
  const [page, setPage] = useState<MyInspectionsPageDto | null>(null);
  const [copies, setCopies] = useState<InspectionCopy[]>([]);
  const [error, setError] = useState<string | null>(null);

  const syncedCount = outbox.filter((item) => item.state === 'synced').length;
  const load = useCallback(async () => {
    if (!user) return;
    if (online) {
      try {
        const result = await inspectionsService.mine(tab);
        setPage(result);
        setError(null);
        void refreshTemplatePack(user.id);
        // Keep the inspector's own open inspections on the device (T-80).
        if (tab !== 'to_review') {
          for (const item of result.items.slice(0, KEEP_MAX)) {
            const dto = await inspectionsService.get(item.projectId, item.id).catch(() => null);
            if (dto) await keepFromServer(user.id, dto);
          }
        }
      } catch (failure) {
        setError(errorMessage(failure));
      }
    }
    setCopies(await listCopies(user.id));
  }, [user, online, tab, errorMessage]);

  useEffect(() => {
    void load();
  }, [load, syncedCount]);

  if (!user) return null;
  const pending = new Set(outbox.filter((item) => item.state !== 'synced').map((item) => item.entityId));
  const deviceOnly = copies.filter(
    (copy) =>
      (copy.status === 'in_progress' || copy.status === 'draft' || copy.submittedHere) &&
      (!online || pending.has(copy.id) || !page?.items.some((item) => item.id === copy.id)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link
          href={START_ROUTE}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-white hover:bg-primary/90"
        >
          <Play aria-hidden className="size-5" />
          {t('start')}
        </Link>
      </div>
      {!online ? <Alert tone="info">{t('offline')}</Alert> : null}
      {online ? (
        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => {
                setTab(name);
                setPage(null);
              }}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium',
                tab === name ? 'border-primary bg-primary text-white' : 'border-border hover:bg-muted',
              )}
            >
              {t(`tabs.${name}`)}
              {page ? (
                <span className="tabular-nums">
                  {name === 'assigned' ? page.counts.assigned : name === 'in_progress' ? page.counts.inProgress : page.counts.toReview}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {deviceOnly.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="on-device">
          <h2 id="on-device" className="text-lg font-semibold">{t('onDevice')}</h2>
          <ul className="flex flex-col gap-2">
            {deviceOnly.map((copy) => (
              <li key={copy.id}>
                <Link
                  href={captureHref(copy.projectId, copy.id)}
                  className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 hover:bg-muted/50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {copy.reference ? <bdi dir="ltr" className="text-sm font-semibold">{copy.reference}</bdi> : <NotSyncedChip />}
                    <InspectionStatusChip status={copy.submittedHere ? 'submitted' : copy.status} />
                    {pending.has(copy.id) ? <span className="text-xs text-muted-foreground">{t('waitingToSync')}</span> : null}
                  </div>
                  <span className="font-medium">{name(copy)}</span>
                  <span className="text-sm text-muted-foreground">
                    <bdi dir="ltr">{copy.projectCode}</bdi>
                    {copy.placeName ? ` · ${copy.placeName}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {online ? (
        !page ? (
          <div className="flex items-center gap-3" role="status">
            <Spinner />
            {tc('loading')}
          </div>
        ) : page.items.length === 0 ? (
          <p className="text-muted-foreground">{t(`empty.${tab}`)}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {page.items.map((item) => (
              <InspectionCard
                key={item.id}
                item={item}
                href={
                  tab === 'to_review'
                    ? `/projects/${item.projectId}/inspections/${item.id}`
                    : captureHref(item.projectId, item.id)
                }
              />
            ))}
          </ul>
        )
      ) : deviceOnly.length === 0 ? (
        <p className="text-muted-foreground">{t('nothingOffline')}</p>
      ) : null}
    </div>
  );
}
