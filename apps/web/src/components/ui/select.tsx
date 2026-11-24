import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';

import { cn } from '@/utils/cn';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

/** Native select styled like `Input`: best keyboard, screen reader and phone support. */
export function Select({ className, invalid, children, dir, ...props }: SelectProps) {
  // The direction also places the chevron, so an LTR select (time zones) stays readable in RTL.
  return (
    <div className="relative" dir={dir}>
      <select
        aria-invalid={invalid ?? undefined}
        className={cn(
          'min-h-12 w-full appearance-none rounded-lg border border-border bg-background ps-4 pe-10 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60',
          invalid && 'border-danger',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute inset-y-0 end-3 my-auto size-5 text-muted-foreground"
      />
    </div>
  );
}
