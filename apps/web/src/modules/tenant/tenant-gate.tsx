'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { FullPageLoading, FullPageMessage } from '@/components/layout/full-page-message';
import { Button } from '@/components/ui/button';

import { useTenant } from './tenant-provider';

/** Renders the app only on a valid subdomain or the platform domain (PLT-02). */
export function TenantGate({ children }: { children: ReactNode }) {
  const state = useTenant();
  const t = useTranslations();

  if (state.status === 'loading') return <FullPageLoading label={t('common.loading')} />;

  if (state.status === 'not-found') {
    return (
      <FullPageMessage
        title={t('tenant.notFoundTitle')}
        body={t('tenant.notFoundBody')}
        action={
          <a
            href={platformHomeUrl()}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('tenant.goToPlatform')}
          </a>
        }
      />
    );
  }

  if (state.status === 'error') {
    return (
      <FullPageMessage
        title={t('errors.SERVICE_UNAVAILABLE')}
        body={t('errors.generic')}
        action={
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('common.retry')}
          </Button>
        }
      />
    );
  }

  return children;
}

/** The base domain: the current host without its first label (acme.example.com → example.com). */
function platformHomeUrl(): string {
  const { protocol, hostname, port } = window.location;
  const base = hostname.split('.').slice(1).join('.') || hostname;
  return `${protocol}//${base}${port ? `:${port}` : ''}/`;
}
