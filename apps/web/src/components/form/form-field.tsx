import type { ReactNode } from 'react';

export interface FormFieldProps {
  id: string;
  label: string;
  required?: boolean;
  requiredLabel?: string;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * Label + control + inline error, with a required indicator (UI/UX rules: inline validation,
 * required field indicators, helpful error messages). The control must use `id`,
 * `aria-describedby={`${id}-error`}` and `aria-invalid` when `error` is set.
 */
export function FormField({
  id,
  label,
  required,
  requiredLabel,
  error,
  hint,
  children,
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span className="ms-1 text-danger" title={requiredLabel} aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
