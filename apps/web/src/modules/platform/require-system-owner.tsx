'use client';

import type { CurrentUserDto } from '@hse/shared';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useAuth } from '@/modules/auth/auth-provider';
import { useCompany } from '@/modules/tenant/tenant-provider';

/** T-14: until the permission matrix (Sprint 5), only the `system_owner` platform role. */
export function isSystemOwner(user: CurrentUserDto | null): boolean {
  return Boolean(
    user?.roles.some((role) => role.roleCode === 'system_owner' && role.scopeLevel === 'platform'),
  );
}

/**
 * The platform console is for System Owners on the base domain. The API enforces this;
 * the guard only avoids showing screens whose requests would be refused.
 */
export function RequireSystemOwner({ children }: { children: ReactNode }) {
  const t = useTranslations('platformRegistrations');
  const { user } = useAuth();
  const company = useCompany();

  if (company || !isSystemOwner(user)) {
    return (
      <div className="flex flex-col items-start gap-4">
        <ShieldAlert aria-hidden className="size-10 text-danger" />
        <h1 className="text-2xl font-semibold">{t('forbiddenTitle')}</h1>
        <p className="text-muted-foreground">{t('forbiddenBody')}</p>
        <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('backHome')}
        </Link>
      </div>
    );
  }
  return children;
}
