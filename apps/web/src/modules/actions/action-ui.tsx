'use client';

import type {
  ActionDueState,
  ActionListItemDto,
  ActionPriority,
  ActionStatus,
} from '@hse/shared';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Lock,
  MapPin,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useDateFormat } from '@/modules/i18n/use-date-format';
import { cn } from '@/utils/cn';

const STATUS_STYLE: Record<ActionStatus, { Icon: typeof Circle; tone: string }> = {
  open: { Icon: Circle, tone: 'bg-info-surface text-info-foreground' },
  in_progress: { Icon: CircleDot, tone: 'bg-warning-surface text-warning-foreground' },
  completed: { Icon: Clock, tone: 'bg-muted text-foreground' },
  verified: { Icon: ShieldCheck, tone: 'bg-success-surface text-success-foreground' },
  closed: { Icon: Lock, tone: 'bg-inactive text-white' },
};

/** PLT-23 UI: status with icon and text, never colour alone. */
export function ActionStatusChip({ status, voided }: { status: ActionStatus; voided?: boolean }) {
  const t = useTranslations('actions.status');
  if (voided) {
    return (
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium line-through">
        {t('voided')}
      </span>
    );
  }
  const { Icon, tone } = STATUS_STYLE[status];
  return (
    <span
      className={cn('inline-flex w-fit items-center gap-1 rounded-full px-2 text-xs font-medium', tone)}
    >
      <Icon aria-hidden className="size-3.5" />
      {t(status)}
    </span>
  );
}

const PRIORITY_STYLE: Record<ActionPriority, { Icon: typeof Circle; tone: string }> = {
  low: { Icon: ArrowDown, tone: 'text-muted-foreground' },
  medium: { Icon: Circle, tone: 'text-foreground' },
  high: { Icon: ArrowUp, tone: 'text-warning-foreground' },
  critical: { Icon: AlertOctagon, tone: 'text-danger' },
};

export function PriorityChip({ priority }: { priority: ActionPriority }) {
  const t = useTranslations('actions.priority');
  const { Icon, tone } = PRIORITY_STYLE[priority];
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-medium', tone)}>
      <Icon aria-hidden className="size-4" />
      {t(priority)}
    </span>
  );
}

/** T-59 due badge: "Overdue · 3 days", "Due today", "Due in 2 days" or the date. */
export function DueBadge({
  state,
  dueOn,
  daysOverdue,
}: {
  state: ActionDueState;
  dueOn: string;
  daysOverdue: number;
}) {
  const t = useTranslations('actions.due');
  const { calendarDate } = useDateFormat();
  if (state === 'done') return null;
  const map = {
    overdue: { Icon: AlertTriangle, tone: 'text-danger', text: t('overdue', { count: daysOverdue }) },
    due_today: { Icon: CalendarClock, tone: 'text-warning-foreground', text: t('today') },
    due_soon: {
      Icon: CalendarClock,
      tone: 'text-warning-foreground',
      text: t('soon', { date: calendarDate(dueOn) }),
    },
    on_track: { Icon: CalendarClock, tone: 'text-muted-foreground', text: t('on', { date: calendarDate(dueOn) }) },
  } as const;
  const { Icon, tone, text } = map[state];
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-medium', tone)}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {text}
    </span>
  );
}

/** One action in a list (PLT-24): number, title, chips, owner, place, source. */
export function ActionCard({
  item,
  showProject = false,
}: {
  item: ActionListItemDto;
  showProject?: boolean;
}) {
  const t = useTranslations('actions');
  const overdue = item.dueState === 'overdue';
  return (
    <li>
      <Link
        href={`/projects/${item.projectId}/actions/${item.id}`}
        className={cn(
          'flex flex-col gap-2 rounded-xl border p-4 hover:bg-muted',
          overdue ? 'border-danger border-s-4' : 'border-border',
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <bdi dir="ltr" className="font-mono text-muted-foreground">
            {item.reference}
          </bdi>
          <ActionStatusChip status={item.status} voided={item.voided} />
          <PriorityChip priority={item.priority} />
          <DueBadge state={item.dueState} dueOn={item.dueOn} daysOverdue={item.daysOverdue} />
        </div>
        <p className={cn('font-medium', item.voided ? 'line-through' : '')}>
          <bdi>{item.title}</bdi>
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {item.owner.hasAccess ? null : <UserX aria-hidden className="size-4 text-danger" />}
            {t('ownerLine', { name: item.owner.name })}
            {item.owner.hasAccess ? null : (
              <span className="text-danger">{t('ownerNoAccess')}</span>
            )}
          </span>
          {item.place ? (
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden className="size-4" />
              <bdi>{item.place.names.join(' › ')}</bdi>
            </span>
          ) : null}
          {item.progressPercent !== null && item.status === 'in_progress' ? (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 aria-hidden className="size-4" />
              {t('percent', { value: item.progressPercent })}
            </span>
          ) : null}
          {showProject ? (
            <bdi dir="ltr" className="font-mono">
              {item.projectCode}
            </bdi>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
