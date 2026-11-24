import { LoaderCircle } from 'lucide-react';

import { cn } from '@/utils/cn';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <LoaderCircle
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
      className={cn('size-5 animate-spin', className)}
    />
  );
}
