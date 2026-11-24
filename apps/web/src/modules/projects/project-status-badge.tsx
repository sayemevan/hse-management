'use client';

import type { ProjectStatus } from '@hse/shared';
import { Archive, CircleCheck, CirclePause, Flag, HardHat, PencilRuler } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/utils/cn';

const STYLES: Record<ProjectStatus, { Icon: typeof Flag; className: string }> = {
  planning: { Icon: PencilRuler, className: 'bg-muted text-foreground' },
  mobilization: { Icon: HardHat, className: 'bg-info-surface text-info-foreground' },
  active: { Icon: Flag, className: 'bg-success-surface text-success-foreground' },
  on_hold: { Icon: CirclePause, className: 'bg-warning-surface text-warning-foreground' },
  completed: { Icon: CircleCheck, className: 'bg-info-surface text-info-foreground' },
  archived: { Icon: Archive, className: 'bg-inactive text-white' },
};

/** Project status with an icon and text, never colour alone (Doc 05 §13). */
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations('projectStatus');
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
