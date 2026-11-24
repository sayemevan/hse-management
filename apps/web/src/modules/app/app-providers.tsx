'use client';

import type { ReactNode } from 'react';

import { AuthProvider } from '@/modules/auth/auth-provider';
import { LanguageSync } from '@/modules/i18n/language-sync';
import { TenantGate } from '@/modules/tenant/tenant-gate';
import { TenantProvider } from '@/modules/tenant/tenant-provider';

/** Client-side context for every page: tenant, then session, then language. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TenantProvider>
      <AuthProvider>
        <LanguageSync />
        <TenantGate>{children}</TenantGate>
      </AuthProvider>
    </TenantProvider>
  );
}
