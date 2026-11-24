import type { Language } from '@hse/shared';

/** The company a request belongs to (PLT-02). */
export interface TenantCompany {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly defaultLanguage: Language;
  readonly timeZone: string;
  readonly logoFileId: string | null;
  /** `read_only` companies can sign in and view, but not create records (D-18, Sprint 4). */
  readonly readOnly: boolean;
}

/**
 * Every tenant-aware request runs in exactly one context: the platform (base domain) or
 * one company (its subdomain). Repositories receive it and always filter by it.
 */
export type TenantContext =
  { readonly kind: 'platform' } | { readonly kind: 'company'; readonly company: TenantCompany };

export function tenantCompanyId(tenant: TenantContext): string | null {
  return tenant.kind === 'company' ? tenant.company.id : null;
}
