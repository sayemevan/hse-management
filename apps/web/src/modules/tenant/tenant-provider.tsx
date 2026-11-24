'use client';

import { ErrorCode, type TenantDto } from '@hse/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { ApiClientError, apiRequest } from '@/services/api-client';

export type TenantState =
  | { status: 'loading' }
  | { status: 'ready'; tenant: TenantDto }
  | { status: 'not-found' }
  | { status: 'error' };

const TenantContext = createContext<TenantState>({ status: 'loading' });

/**
 * Loads the public profile of the current subdomain once (PLT-02): company name, logo,
 * default language and time zone — or the platform context on the base domain.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TenantState>({ status: 'loading' });
  // Bumped after the company changes its name, language or logo (US-012 – US-014).
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<TenantDto>('/tenant', { signal: controller.signal })
      .then((response) => {
        setState({ status: 'ready', tenant: response.data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const notFound =
          error instanceof ApiClientError && error.code === ErrorCode.TENANT_NOT_FOUND;
        // A failed reload keeps what is already shown.
        setState((current) =>
          current.status === 'ready' ? current : { status: notFound ? 'not-found' : 'error' },
        );
      });
    return () => {
      controller.abort();
    };
  }, [version]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  return (
    <TenantReloadContext value={reload}>
      <TenantContext value={state}>{children}</TenantContext>
    </TenantReloadContext>
  );
}

const TenantReloadContext = createContext<() => void>(() => undefined);

export function useTenant(): TenantState {
  return useContext(TenantContext);
}

/** Reloads the subdomain's public profile, e.g. after a new logo. */
export function useReloadTenant(): () => void {
  return useContext(TenantReloadContext);
}

/** The company profile, or null on the platform domain / while loading. */
export function useCompany(): TenantDto['company'] | null {
  const state = useTenant();
  return state.status === 'ready' ? (state.tenant.company ?? null) : null;
}
