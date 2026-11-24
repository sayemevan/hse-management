'use client';

import type { PlanDto } from '@hse/shared';
import { CircleCheck, Circle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/utils/cn';

const BYTES_PER_GB = 1024 ** 3;

/** Plan cards as a radio group (PLT-06). Prices show "Price on request" until F-02b is decided. */
export function PlanPicker({
  plans,
  value,
  onChange,
  error,
}: {
  plans: PlanDto[];
  value: string;
  onChange: (code: string) => void;
  error?: string | undefined;
}) {
  const t = useTranslations('registration.plan');
  const format = useFormatter();

  const price = (plan: PlanDto) =>
    plan.monthlyPrice === null
      ? t('priceOnRequest')
      : t('monthlyPrice', {
          price: format.number(plan.monthlyPrice, { style: 'currency', currency: 'SAR' }),
        });

  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-labelledby="plan-legend"
        aria-describedby={error ? 'planCode-error' : undefined}
        className="grid gap-3"
      >
        {plans.map((plan) => {
          const selected = plan.code === value;
          const Icon = selected ? CircleCheck : Circle;
          return (
            <label
              key={plan.code}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                selected
                  ? 'border-primary bg-info-surface ring-1 ring-primary'
                  : 'border-border hover:bg-muted',
                error && !value && 'border-danger',
              )}
            >
              <input
                type="radio"
                name="planCode"
                value={plan.code}
                checked={selected}
                onChange={() => {
                  onChange(plan.code);
                }}
                className="sr-only"
              />
              <Icon
                aria-hidden
                className={cn(
                  'mt-0.5 size-5 shrink-0',
                  selected ? 'text-primary' : 'text-muted-foreground',
                )}
              />
              <span className="flex flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold">{plan.name}</span>
                  <span className="text-sm font-medium text-muted-foreground">{price(plan)}</span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {plan.maxProjects === null
                    ? t('unlimitedProjects')
                    : t('projects', { count: plan.maxProjects })}
                  {' · '}
                  {plan.maxUsers === null
                    ? t('unlimitedUsers')
                    : t('users', { count: plan.maxUsers })}
                  {' · '}
                  {t('storage', {
                    size: format.number(plan.maxStorageBytes / BYTES_PER_GB, {
                      maximumFractionDigits: 0,
                    }),
                  })}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id="planCode-error" tabIndex={-1} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
