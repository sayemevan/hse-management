'use client';

import { MY_ACTION_TABS, type MyActionTab, type MyActionsPageDto } from '@hse/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/modules/app/use-load';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { cn } from '@/utils/cn';

import { ActionCard } from './action-ui';
import { myActionsService } from './actions.service';

/** PLT-24: My actions — Owned · Collaborating · To verify, across projects. */
export function MyActionsScreen() {
  const t = useTranslations('actions.mine');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = params.get('tab');
  const tab: MyActionTab = (MY_ACTION_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as MyActionTab)
    : 'owned';
  const due = (params.get('due') ?? '').split(',').filter(Boolean);
  const [pages, setPages] = useState<MyActionsPageDto[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${tab}:${due.join(',')}`;

  const loaded = useLoad(
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers tab and due
    useCallback(() => myActionsService.list(tab, due, 0), [key]),
    key,
  );
  const first = loaded.status === 'ready' ? loaded.value : null;
  const items = first ? [first, ...pages].flatMap((page) => page.items) : [];
  const nextCursor = (pages.at(-1) ?? first)?.nextCursor ?? null;

  const go = (next: { tab?: MyActionTab; due?: string | null }) => {
    const query = new URLSearchParams(params.toString());
    if (next.tab) query.set('tab', next.tab);
    if (next.due !== undefined) {
      if (next.due) query.set('due', next.due);
      else query.delete('due');
    }
    setPages([]);
    router.replace(`${pathname}?${query.toString()}`);
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('title')}>
        {MY_ACTION_TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              go({ tab: value, due: null });
            }}
            className={cn(
              'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium',
              tab === value ? 'border-primary bg-primary text-white' : 'border-border hover:bg-muted',
            )}
          >
            {t(`tabs.${value}`)}
            {first ? (
              <span className="rounded-full bg-background/20 px-1.5 tabular-nums">
                {first.counts[value]}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {due.length > 0 ? (
        <Alert tone="info">
          {t('filteredDue')}{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              go({ due: null });
            }}
          >
            {t('showAll')}
          </button>
        </Alert>
      ) : null}
      {loaded.status === 'error' ? (
        <Alert tone="danger">{errorMessage(loaded.error)}</Alert>
      ) : !first ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc('loading')}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <ActionCard key={item.id} item={item} showProject />
            ))}
          </ul>
          {nextCursor !== null ? (
            <Button
              variant="secondary"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                myActionsService
                  .list(tab, due, nextCursor)
                  .then((page) => {
                    setPages((current) => [...current, page]);
                  }, () => undefined)
                  .finally(() => {
                    setLoadingMore(false);
                  });
              }}
            >
              {loadingMore ? <Spinner /> : null}
              {t('loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
