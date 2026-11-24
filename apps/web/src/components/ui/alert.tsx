import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/utils/cn';

const alertVariants = cva('flex items-start gap-3 rounded-lg border p-4 text-sm', {
  variants: {
    tone: {
      info: 'border-info/30 bg-info-surface text-info-foreground',
      success: 'border-success/30 bg-success-surface text-success-foreground',
      warning: 'border-warning/40 bg-warning-surface text-warning-foreground',
      danger: 'border-danger/30 bg-danger-surface text-danger-foreground',
    },
  },
  defaultVariants: { tone: 'info' },
});

// Every status carries an icon as well as colour (Doc 05 §13: never colour alone).
const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

export type AlertProps = VariantProps<typeof alertVariants> & {
  children: ReactNode;
  className?: string;
};

export function Alert({ tone, children, className }: AlertProps) {
  const Icon = ICONS[tone ?? 'info'];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
