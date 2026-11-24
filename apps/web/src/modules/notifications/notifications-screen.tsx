'use client';

import type { NotificationDto } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useErrorMessage } from '@/modules/i18n/use-error-message';
import { cn } from '@/utils/cn';

import { NotificationList } from './notification-list';
import { notificationsService } from './notifications.service';

/** PLT-17: the full history, All / Unread, 25 at a time. */
export function NotificationsScreen() {
  const t = useTranslations('notifications');
  const errorMessage = useErrorMessage();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    (before: string | null) => {
      setError(null);
      if (before) setLoadingMore(true);
      notificationsService
        .list({ unread: unreadOnly, before })
        .then(
          (page) => {
            setItems((current) => (before && current ? [...current, ...page.items] : page.items));
            setNext(page.nextBefore);
          },
          (failure: unknown) => {
            setError(errorMessage(failure));
            setItems((current) => current ?? []);
          },
        )
        .finally(() => {
          setLoadingMore(false);
        });
    },
    [unreadOnly, errorMessage],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load(null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const tab = (value: boolean, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={unreadOnly === value}
      onClick={() => {
        setItems(null);
        setUnreadOnly(value);
      }}
      className={cn(
        'min-h-12 border-b-2 px-4 font-medium',
        unreadOnly === value ? 'border-primary text-primary' : 'border-transparent',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Button
          variant="secondary"
          onClick={() => {
            void notificationsService.markAllRead().then(() => {
              load(null);
            });
          }}
        >
          {t('markAllRead')}
        </Button>
      </div>
      <div role="tablist" className="flex border-b border-border">
        {tab(false, t('all'))}
        {tab(true, t('unread'))}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Card className="p-0">
        {items === null ? (
          <div className="flex justify-center p-6" role="status">
            <Spinner />
          </div>
        ) : (
          <NotificationList items={items} />
        )}
      </Card>
      {next ? (
        <Button
          variant="secondary"
          disabled={loadingMore}
          onClick={() => {
            load(next);
          }}
        >
          {loadingMore ? <Spinner /> : null}
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
