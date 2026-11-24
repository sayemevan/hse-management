'use client';

import type { PaymentStatus, SubscriptionState } from '@hse/shared';
import { CircleCheck, CircleX, Clock, Hourglass, Lock, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/utils/cn';

const BADGE =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap';

const STATE_STYLES: Record<SubscriptionState, { Icon: typeof Clock; className: string }> = {
  trial: { Icon: Clock, className: 'bg-info-surface text-info-foreground' },
  active: { Icon: CircleCheck, className: 'bg-success-surface text-success-foreground' },
  grace: { Icon: Hourglass, className: 'bg-warning-surface text-warning-foreground' },
  read_only: { Icon: Lock, className: 'bg-danger-surface text-danger-foreground' },
};

/** Subscription state with an icon and text, never colour alone (Doc 05 §13). */
export function SubscriptionStateBadge({ state }: { state: SubscriptionState }) {
  const t = useTranslations('subscription.state');
  const { Icon, className } = STATE_STYLES[state];
  return (
    <span className={cn(BADGE, className)}>
      <Icon aria-hidden className="size-4" />
      {t(state)}
    </span>
  );
}

const PAYMENT_STYLES: Record<PaymentStatus, { Icon: typeof Clock; className: string }> = {
  pending: { Icon: Hourglass, className: 'bg-info-surface text-info-foreground' },
  confirmed: { Icon: CircleCheck, className: 'bg-success-surface text-success-foreground' },
  rejected: { Icon: CircleX, className: 'bg-danger-surface text-danger-foreground' },
  withdrawn: { Icon: Undo2, className: 'bg-muted text-muted-foreground' },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const t = useTranslations('subscription.paymentStatus');
  const { Icon, className } = PAYMENT_STYLES[status];
  return (
    <span className={cn(BADGE, className)}>
      <Icon aria-hidden className="size-4" />
      {t(status)}
    </span>
  );
}
