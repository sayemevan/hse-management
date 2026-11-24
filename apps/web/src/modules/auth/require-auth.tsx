'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';

import { FullPageLoading, FullPageMessage } from '@/components/layout/full-page-message';
import { Button } from '@/components/ui/button';

import { useAuth } from './auth-provider';
import { loginPathFor } from './safe-redirect';

/**
 * Protects signed-in pages. Signed-out visitors go to the login page and come back afterwards;
 * an expired session shows an explanation first (US-010 FR-6).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const t = useTranslations();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const loginPath = loginPathFor(query ? `${pathname}?${query}` : pathname);

  useEffect(() => {
    if (status === 'signed-out') router.replace(loginPath);
  }, [status, router, loginPath]);

  if (status === 'expired') {
    return (
      <FullPageMessage
        title={t('session.expiredTitle')}
        body={t('session.expiredBody')}
        action={
          <Button
            fullWidth
            onClick={() => {
              router.replace(loginPath);
            }}
          >
            {t('session.signInAgain')}
          </Button>
        }
      />
    );
  }

  if (status !== 'signed-in') return <FullPageLoading label={t('common.loading')} />;
  return children;
}
