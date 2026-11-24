'use client';

import type { TenantSubscriptionDto } from '@hse/shared';

import { useCompany } from '@/modules/tenant/tenant-provider';

/** The company's subscription state from the tenant profile (PLT-11 FR-5), or null. */
export function useSubscriptionState(): TenantSubscriptionDto | null {
  return useCompany()?.subscription ?? null;
}

/**
 * True while the workspace is read-only (D-18): screens hide or disable their create, edit
 * and delete controls (PLT-11 FR-7). The API refuses those writes anyway.
 */
export function useReadOnly(): boolean {
  return useSubscriptionState()?.state === 'read_only';
}
