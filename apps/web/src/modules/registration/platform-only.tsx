'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { FullPageMessage } from '@/components/layout/full-page-message';
import { useCompany } from '@/modules/tenant/tenant-provider';

/**
 * Registration lives on the base domain only (US-011.1 permission rules). On a company
 * subdomain these pages say so instead of showing the form. `TenantGate` has already
 * resolved the context when this renders.
 */
export function PlatformOnly({ children }: { children: ReactNode }) {
  const t = useTranslations('registration');
  const company = useCompany();
  if (company) {
    return <FullPageMessage title={t('platformOnlyTitle')} body={t('platformOnlyBody')} />;
  }
  return children;
}
