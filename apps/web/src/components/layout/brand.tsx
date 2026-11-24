'use client';

import { Building2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useCompany } from '@/modules/tenant/tenant-provider';

/** Company logo and name on a company subdomain; the platform name on the base domain. */
export function Brand({ size = 'default' }: { size?: 'default' | 'large' }) {
  const t = useTranslations('common');
  const company = useCompany();
  const Icon = company ? Building2 : ShieldCheck;
  const large = size === 'large';

  return (
    <div className="flex items-center gap-3">
      {company?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- logos are served from R2 (Sprint 2)
        <img
          src={company.logoUrl}
          alt=""
          className={large ? 'size-14 rounded-lg' : 'size-9 rounded-md'}
        />
      ) : (
        <span
          aria-hidden
          className={`flex items-center justify-center rounded-lg bg-primary text-primary-foreground ${large ? 'size-14' : 'size-9'}`}
        >
          <Icon className={large ? 'size-7' : 'size-5'} />
        </span>
      )}
      <span className={large ? 'text-xl font-semibold' : 'font-semibold'}>
        {/* <bdi>: a Latin name inside Arabic text keeps its punctuation in place. */}
        <bdi>{company?.name ?? t('platformName')}</bdi>
      </span>
    </div>
  );
}
