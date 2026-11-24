'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { FullPageMessage } from '@/components/layout/full-page-message';

import { useCompany } from './tenant-provider';

/** Pages that exist only on a company subdomain, such as accepting an invitation (T-17). */
export function CompanyOnly({ children }: { children: ReactNode }) {
  const t = useTranslations('tenant');
  const company = useCompany();
  if (!company)
    return <FullPageMessage title={t('companyOnlyTitle')} body={t('companyOnlyBody')} />;
  return children;
}
