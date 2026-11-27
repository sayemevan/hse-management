'use client';

import type { ReactNode } from 'react';

import { AuthProvider } from '@/modules/auth/auth-provider';
import { LanguageSync } from '@/modules/i18n/language-sync';
import { PwaProvider } from '@/modules/offline/pwa-provider';
import { SyncProvider } from '@/modules/offline/sync-provider';
import { TenantGate } from '@/modules/tenant/tenant-gate';
import { TenantProvider } from '@/modules/tenant/tenant-provider';

/**
 * Client-side context for every page: tenant, then session, then language. Sprint 9: the sync
 * engine and the service worker (PLT-25, PLT-28).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TenantProvider>
      <AuthProvider>
        <SyncProvider>
          <PwaProvider>
            <LanguageSync />
            <TenantGate>{children}</TenantGate>
          </PwaProvider>
        </SyncProvider>
      </AuthProvider>
    </TenantProvider>
  );
}
