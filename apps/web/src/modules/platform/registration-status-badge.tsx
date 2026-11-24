'use client';

import type { RegistrationStatus } from '@hse/shared';
import { Archive, CircleCheck, CircleX, Hourglass, MailQuestion } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/utils/cn';

const STYLES: Record<RegistrationStatus, { Icon: typeof Archive; className: string }> = {
  pending_email_verification: { Icon: MailQuestion, className: 'bg-muted text-muted-foreground' },
  submitted: { Icon: Hourglass, className: 'bg-info-surface text-info-foreground' },
  rejected: { Icon: CircleX, className: 'bg-danger-surface text-danger-foreground' },
  approved: { Icon: CircleCheck, className: 'bg-success-surface text-success-foreground' },
  closed: { Icon: Archive, className: 'bg-muted text-muted-foreground' },
};

/** Registration status with an icon and text, never colour alone (Doc 05 §13). */
export function RegistrationStatusBadge({ status }: { status: RegistrationStatus }) {
  const t = useTranslations('platformRegistrations.status');
  const { Icon, className } = STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        className,
      )}
    >
      <Icon aria-hidden className="size-4" />
      {t(status)}
    </span>
  );
}
