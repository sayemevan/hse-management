'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/utils/cn';

import { Input, type InputProps } from './input';

export type PasswordInputProps = Omit<InputProps, 'type'> & {
  showLabel: string;
  hideLabel: string;
};

/** Password field with a show/hide toggle (Doc 15 UI requirements). */
export function PasswordInput({ showLabel, hideLabel, className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const label = visible ? hideLabel : showLabel;
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={cn('pe-14', className)} {...props} />
      <button
        type="button"
        onClick={() => {
          setVisible((current) => !current);
        }}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 end-0 flex w-12 items-center justify-center rounded-e-lg text-muted-foreground hover:text-foreground"
      >
        <Icon aria-hidden className="size-5" />
      </button>
    </div>
  );
}
