import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/utils/cn';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  id: string;
  label: ReactNode;
  invalid?: boolean;
  error?: string | null;
};

/**
 * A checkbox with its label as one large touch target (Doc 03 Rule 12) and an inline error.
 * The error is linked through `aria-describedby` as `${id}-error`.
 */
export function Checkbox({ id, label, invalid, error, className, ...props }: CheckboxProps) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-12 cursor-pointer items-start gap-3 rounded-lg py-2 text-foreground',
          className,
        )}
      >
        <input
          id={id}
          type="checkbox"
          aria-invalid={invalid ?? undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 size-5 shrink-0 accent-primary"
          {...props}
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
