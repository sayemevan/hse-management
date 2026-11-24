'use client';

import { evaluatePassword, PASSWORD_RULES } from '@hse/shared';
import { Check, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/utils/cn';

/** Live checklist of the password policy (D-03); each rule shows an icon and text, not colour alone. */
export function PasswordChecklist({
  password,
  id,
  title,
}: {
  password: string;
  id: string;
  title?: string;
}) {
  const t = useTranslations('changePassword');
  const results = evaluatePassword(password);

  return (
    <div id={id} className="rounded-lg bg-muted p-3 text-sm">
      <p className="mb-2 font-medium">{title ?? t('rulesTitle')}</p>
      <ul className="flex flex-col gap-1.5">
        {PASSWORD_RULES.map((rule) => {
          const met = results[rule];
          const Icon = met ? Check : Circle;
          return (
            <li
              key={rule}
              className={cn(
                'flex items-center gap-2',
                met ? 'text-success-foreground' : 'text-muted-foreground',
              )}
            >
              <Icon aria-hidden className={cn('size-4 shrink-0', met && 'text-success')} />
              <span>{t(`rules.${rule}`)}</span>
              <span className="sr-only">{met ? t('ruleMet') : t('ruleNotMet')}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
