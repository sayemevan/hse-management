'use client';

import type { NotificationDto } from '@hse/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useDateFormat } from '@/modules/i18n/use-date-format';
import { cn } from '@/utils/cn';

import { notificationsService } from './notifications.service';
import { useNotificationText, useRelativeTime } from './use-notification-text';

/** Notification rows shared by the bell panel and the Notifications page (PLT-17). */
export function NotificationList({
  items,
  onOpened,
}: {
  items: NotificationDto[];
  onOpened?: () => void;
}) {
  const t = useTranslations('notifications');
  const text = useNotificationText();
  const relative = useRelativeTime();
  const { dateTime } = useDateFormat();
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);

  const open = async (item: NotificationDto) => {
    setOpening(item.id);
    try {
      const result = await notificationsService.open(item.id);
      onOpened?.();
      if (!result.access) router.push('/notifications/no-access');
      else if (result.route) router.push(result.route);
    } finally {
      setOpening(null);
    }
  };

  if (items.length === 0) {
    return <p className="p-4 text-center text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const unread = item.readAt === null;
        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={opening === item.id}
              onClick={() => void open(item)}
              className="flex min-h-12 w-full items-start gap-3 p-3 text-start hover:bg-muted focus-visible:outline-2"
            >
              <span
                aria-hidden
                className={cn(
                  'mt-2 size-2 shrink-0 rounded-full',
                  unread ? 'bg-primary' : 'bg-transparent',
                )}
              />
              <span className="flex flex-1 flex-col gap-1">
                <span className={cn(unread && 'font-semibold')}>
                  {unread ? <span className="sr-only">{t('unreadLabel')} </span> : null}
                  {text(item)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {item.actorName ? `${item.actorName} · ` : ''}
                  <time
                    dateTime={new Date(item.createdAt).toISOString()}
                    title={dateTime(item.createdAt)}
                  >
                    {relative(item.createdAt)}
                  </time>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
