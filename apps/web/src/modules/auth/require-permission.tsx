'use client';

import type { CurrentUserDto } from '@hse/shared';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useCompany } from '@/modules/tenant/tenant-provider';

import { useAuth } from './auth-provider';

/** Company permissions the server reported for this user (PLT-08). For showing menus only. */
export function hasPermission(user: CurrentUserDto | null, permission: string): boolean {
  return Boolean(user?.permissions.includes(permission));
}

/**
 * Shows a page only to users who hold `permission` on this company's subdomain. The API
 * enforces the same rule; this only avoids screens whose requests would be refused.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const t = useTranslations('platformRegistrations');
  const { user } = useAuth();
  const company = useCompany();

  if (!company || !hasPermission(user, permission)) {
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
