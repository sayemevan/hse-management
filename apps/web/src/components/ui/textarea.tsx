import type { TextareaHTMLAttributes } from 'react';

import { cn } from '@/utils/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid ?? undefined}
      className={cn(
        'min-h-32 w-full rounded-lg border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60',
        invalid && 'border-danger',
        className,
      )}
      {...props}
    />
  );
}
