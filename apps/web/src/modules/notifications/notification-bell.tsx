'use client';

import { NOTIFICATION_POLL_MS, type NotificationDto } from '@hse/shared';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Spinner } from '@/components/ui/spinner';

import { NotificationList } from './notification-list';
import { notificationsService } from './notifications.service';

/**
 * PLT-17: the bell with the unread count, polled every minute while the tab is visible and
 * at once when it regains focus (T-42). A failed poll keeps the last count.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    notificationsService.unreadCount().then(setCount, () => {
      // Keep the last value; the next poll tries again.
    });
  }, []);

  useEffect(() => {
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, NOTIFICATION_POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const loadPanel = useCallback(() => {
    setItems(null);
    notificationsService.list({ limit: 10 }).then(
      (page) => {
        setItems(page.items);
      },
      () => {
        setItems([]);
      },
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !container.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const label = count === 0 ? t('bellLabel') : t('bellUnread', { count });
  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) loadPanel();
        }}
        className="relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg hover:bg-muted"
      >
        <Bell aria-hidden className="size-5" />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute end-1 top-1 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-semibold leading-5 text-white"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label={t('title')}
          className="fixed inset-x-0 top-14 z-20 max-h-[80dvh] overflow-y-auto border-b border-border bg-background shadow-xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-1 sm:w-96 sm:rounded-xl sm:border"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <h2 className="font-semibold">{t('title')}</h2>
            {count > 0 ? (
              <button
                type="button"
                className="min-h-10 rounded-lg px-2 text-sm font-medium text-primary hover:bg-muted"
                onClick={() => {
                  void notificationsService.markAllRead().then(() => {
                    setCount(0);
                    loadPanel();
                  });
                }}
              >
                {t('markAllRead')}
              </button>
            ) : null}
          </div>
          {items === null ? (
            <div className="flex justify-center p-4" role="status">
              <Spinner />
            </div>
          ) : (
            <NotificationList
              items={items}
              onOpened={() => {
                setOpen(false);
                refresh();
              }}
            />
          )}
          <div className="border-t border-border p-2 text-center">
            <Link
              href="/notifications"
              className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('seeAll')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
