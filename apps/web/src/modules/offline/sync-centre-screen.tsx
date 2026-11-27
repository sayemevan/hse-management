'use client';

import { OFFLINE_LIMITS } from '@hse/shared';
import {
  CircleAlert,
  CircleCheck,
  Clock,
  CloudOff,
  Copy,
  GitCompare,
  Lock,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/modules/auth/auth-provider';
import { useDateFormat } from '@/modules/i18n/use-date-format';
import { cn } from '@/utils/cn';

import { ConflictReview } from './conflict-review';
import { displayLabel } from './registry';
import type { OutboxItem, OutboxState } from './device-store';
import { type KeptPack, listKeptPacks, refreshAllPacks } from './offline-profile';
import { dependentsOf } from './outbox';
import { useSync } from './sync-provider';
import { useSyncReason } from './use-sync-reason';

const TABS = ['pending', 'attention', 'conflicts', 'synced'] as const;
type Tab = (typeof TABS)[number];

const TAB_STATES: Record<Tab, readonly OutboxState[]> = {
  pending: ['pending', 'sending', 'waiting_read_only', 'waiting_sign_in'],
  attention: ['needs_attention'],
  conflicts: ['conflict'],
  synced: ['synced'],
};

function StateBadge({ state }: { state: OutboxState }) {
  const t = useTranslations('offline.states');
  const icons: Record<OutboxState, typeof Clock> = {
    pending: Clock,
    sending: RefreshCw,
    waiting_sign_in: Lock,
    waiting_read_only: Lock,
    needs_attention: CircleAlert,
    conflict: GitCompare,
    synced: CircleCheck,
  };
  const Icon = icons[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        state === 'needs_attention' || state === 'conflict'
          ? 'bg-warning-surface text-warning-foreground'
          : state === 'synced'
            ? 'bg-success-surface text-success-foreground'
            : 'bg-muted text-foreground',
      )}
    >
      <Icon aria-hidden className={cn('size-3.5', state === 'sending' && 'animate-spin')} />
      {t(state)}
    </span>
  );
}

/** PLT-31: Pending, Needs attention, Conflicts, Synced (24 h); storage; offline data. */
export function SyncCentreScreen() {
  const t = useTranslations('offline.centre');
  const locale = useLocale();
  const tk = useTranslations('offline.kinds');
  const params = useSearchParams();
  const conflictId = params.get('conflict');
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { online, syncing, items, counts, storage, available, syncNow, discard } = useSync();
  const reason = useSyncReason();
  const { dateTime } = useDateFormat();
  const requested = params.get('tab');
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'pending';
  const [confirm, setConfirm] = useState<OutboxItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [packs, setPacks] = useState<KeptPack[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadPacks = useCallback(() => {
    if (!user) return;
    listKeptPacks(user.id).then(setPacks, () => {
      setPacks([]);
    });
  }, [user]);
  useEffect(loadPacks, [loadPacks]);

  if (conflictId) {
    return (
      <ConflictReview
        conflictId={conflictId}
        onDone={(message) => {
          setNotice(message);
          router.replace(`${pathname}?tab=conflicts`);
        }}
      />
    );
  }

  const tabCounts: Record<Tab, number> = {
    pending: counts.pending + counts.waitingSignIn,
    attention: counts.attention,
    conflicts: counts.conflicts,
    synced: items.filter((item) => item.state === 'synced').length,
  };
  const shown = items
    .filter((item) => TAB_STATES[tab].includes(item.state))
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
  const usedRatio = storage && storage.quota > 0 ? storage.usage / storage.quota : 0;

  const copy = async (item: OutboxItem) => {
    const text = [displayLabel(item.label, locale), ...Object.values(item.request.body ?? {}).filter((v) => typeof v === 'string')]
      .join('\n')
      .trim();
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setNotice(t('copied'));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {online ? null : <CloudOff aria-hidden className="size-4" />}
            {online ? t('online') : t('offline')}
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!online || syncing}
          onClick={() => void syncNow()}
          title={online ? undefined : t('syncNowOffline')}
        >
          {syncing ? <Spinner /> : <RefreshCw aria-hidden className="size-5" />}
          {online ? t('syncNow') : t('syncNowOffline')}
        </Button>
      </div>

      {!available ? <Alert tone="warning">{t('unavailable')}</Alert> : null}
      {counts.waitingSignIn > 0 ? <Alert tone="warning">{t('signInToFinish', { count: counts.waitingSignIn })}</Alert> : null}
      {usedRatio >= OFFLINE_LIMITS.storageWarnRatio ? (
        <Alert tone="warning">{t('storageWarning', { percent: Math.round(usedRatio * 100) })}</Alert>
      ) : null}
      {counts.pending > 0 ? <p className="text-sm text-muted-foreground">{t('keepOpen')}</p> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-2">
        {TABS.map((key) => (
          <Link
            key={key}
            role="tab"
            aria-selected={tab === key}
            href={`/sync?tab=${key}`}
            replace
            className={cn(
              'inline-flex min-h-12 items-center gap-2 rounded-lg border px-4 font-medium',
              tab === key ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
            )}
          >
            {t(`tabs.${key}`)}
            <span className="rounded-full bg-background/20 px-2 text-sm">{tabCounts[key]}</span>
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
          {t(`empty.${tab}`)}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((item) => {
            const why = item.state === 'synced' ? null : reason(item.lastError);
            return (
              <li key={item.seq} className="flex flex-col gap-2 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    <bdi>{displayLabel(item.label, locale)}</bdi>
                    {item.projectCode ? (
                      <span className="text-muted-foreground">
                        {' · '}
                        <bdi dir="ltr">{item.projectCode}</bdi>
                      </span>
                    ) : null}
                  </span>
                  <StateBadge state={item.state} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {tk(item.kind)} · {t('captured')} <bdi dir="ltr">{dateTime(item.capturedAt)}</bdi>
                  {item.syncedAt ? (
                    <>
                      {' · '}
                      {t('syncedAt')} <bdi dir="ltr">{dateTime(item.syncedAt)}</bdi>
                    </>
                  ) : null}
                </p>
                {why && item.state !== 'pending' ? <p className="text-sm">{why}</p> : null}
                {item.state === 'needs_attention' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void copy(item)}>
                      <Copy aria-hidden className="size-4" />
                      {t('copy')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setConfirm(item);
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                      {t('discard')}
                    </Button>
                  </div>
                ) : null}
                {item.state === 'conflict' && item.conflictId ? (
                  <Link
                    href={`/sync?conflict=${item.conflictId}`}
                    className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
                  >
                    <GitCompare aria-hidden className="size-4" />
                    {t('review')}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('kept.title')}</h2>
          <Button
            size="sm"
            variant="secondary"
            disabled={!online || refreshing || !user}
            onClick={() => {
              if (!user) return;
              setRefreshing(true);
              void refreshAllPacks(user.id).finally(() => {
                setRefreshing(false);
                loadPacks();
              });
            }}
          >
            {refreshing ? <Spinner /> : <RefreshCw aria-hidden className="size-4" />}
            {t('kept.refresh')}
          </Button>
        </div>
        {packs && packs.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {packs.map((pack) => (
              <li key={pack.projectId} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
                <span>
                  <bdi dir="ltr">{pack.code}</bdi> · <bdi>{pack.name}</bdi>
                  {pack.pinned ? ` · ${t('kept.pinned')}` : ''}
                </span>
                <span className="text-muted-foreground">
                  {t('kept.updated')} <bdi dir="ltr">{dateTime(pack.fetchedAt)}</bdi>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('kept.none')}</p>
        )}
        {storage ? (
          <p className="text-sm text-muted-foreground">
            {t('storage', {
              used: (storage.usage / 1024 / 1024).toFixed(1),
              quota: Math.round(storage.quota / 1024 / 1024),
            })}
          </p>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title={t('discardTitle')}
        body={
          confirm
            ? t('discardBody', {
                label: displayLabel(confirm.label, locale),
                extra: dependentsOf(items, confirm.seq ?? -1).length,
              })
            : ''
        }
        confirmLabel={t('discard')}
        cancelLabel={t('cancel')}
        tone="danger"
        onCancel={() => {
          setConfirm(null);
        }}
        onConfirm={() => {
          const seq = confirm?.seq;
          setConfirm(null);
          if (seq !== undefined) void discard(seq).then(() => {
            setNotice(t('discarded'));
          });
        }}
      />
    </div>
  );
}
