'use client';

import type { PlanDto } from '@hse/shared';
import { useEffect, useState } from 'react';

import { useLanguage } from '@/modules/i18n/use-language';
import { registrationService } from '@/modules/registration/registration.service';

/** Active plans in the current language; empty while loading or if the catalogue fails. */
export function usePlans(): PlanDto[] {
  const { language } = useLanguage();
  const [plans, setPlans] = useState<PlanDto[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    registrationService.listPlans(language, controller.signal).then(setPlans, () => {
      // Plan names are a convenience here; codes are shown instead.
    });
    return () => {
      controller.abort();
    };
  }, [language]);

  return plans;
}

export function planName(plans: readonly PlanDto[], code: string | null): string {
  if (!code) return '—';
  return plans.find((plan) => plan.code === code)?.name ?? code;
}
