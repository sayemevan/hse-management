import type { InputHTMLAttributes } from 'react';

import { cn } from '@/utils/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid ?? undefined}
      className={cn(
        'min-h-12 w-full rounded-lg border border-border bg-background px-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60',
        invalid && 'border-danger',
        className,
      )}
      {...props}
    />
  );
}
