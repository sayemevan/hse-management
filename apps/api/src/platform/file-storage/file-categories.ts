import {
  ACTION_FILE_RULES,
  INSPECTION_FILE_RULES,
  LOGO_RULES,
  PAYMENT_PROOF_RULES,
  WORKFORCE_FILE_RULES,
  WORKFORCE_PHOTO_RULES,
} from '@hse/shared';

/** Rules per file category (PLT-07 FR-2). Modules add their categories here. */
export interface FileCategoryRules {
  maxBytes: number;
  contentTypes: readonly string[];
  /** `Cache-Control` sent when the file is served. */
  cacheControl: string;
}

export const FILE_CATEGORIES = {
  // US-014, O-30. Public on the company's subdomain (sign-in page), so it may be cached.
  company_logo: {
    maxBytes: LOGO_RULES.maxBytes,
    contentTypes: LOGO_RULES.contentTypes,
    cacheControl: 'public, max-age=3600',
  },
  // PLT-13, O-39. Private: the company's administrators and the System Owner only.
  payment_proof: {
    maxBytes: PAYMENT_PROOF_RULES.maxBytes,
    contentTypes: PAYMENT_PROOF_RULES.contentTypes,
    cacheControl: 'private, no-store',
  },
  // Sprint 7 (T-49, O-71). Served only through the workforce routes.
  workforce_photo: {
    maxBytes: WORKFORCE_PHOTO_RULES.maxBytes,
    contentTypes: WORKFORCE_PHOTO_RULES.contentTypes,
    cacheControl: 'private, max-age=300',
  },
  workforce_attachment: {
    maxBytes: WORKFORCE_FILE_RULES.maxBytes,
    contentTypes: WORKFORCE_FILE_RULES.contentTypes,
    cacheControl: 'private, no-store',
  },
  workforce_personal: {
    maxBytes: WORKFORCE_FILE_RULES.maxBytes,
    contentTypes: WORKFORCE_FILE_RULES.contentTypes,
    cacheControl: 'private, no-store',
  },
  // Sprint 8 (T-62, O-108). Served only through the action routes, after the view check.
  action_evidence: {
    maxBytes: ACTION_FILE_RULES.maxBytes,
    contentTypes: ACTION_FILE_RULES.contentTypes,
    cacheControl: 'private, no-store',
  },
  // Sprint 10 (O-136): inspection evidence, served by the inspection module (T-83).
  inspection_evidence: {
    maxBytes: INSPECTION_FILE_RULES.maxBytes,
    contentTypes: INSPECTION_FILE_RULES.contentTypes,
    cacheControl: 'private, no-store',
  },
  // Sprint 9 (O-116): sync probe photos, development and test builds only. Module-served.
  sync_probe_photo: {
    maxBytes: 10 * 1024 * 1024,
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    cacheControl: 'private, no-store',
  },
} as const satisfies Record<string, FileCategoryRules>;

export type FileCategory = keyof typeof FILE_CATEGORIES;

/** Categories that don't count against the plan's storage (PLT-13 FR-3: receipts). */
export const QUOTA_EXEMPT_CATEGORIES: readonly FileCategory[] = ['payment_proof'];

/** T-49: categories the generic `GET /files/{id}` never serves (their module checks access). */
export const MODULE_SERVED_CATEGORIES: readonly FileCategory[] = [
  'workforce_photo',
  'workforce_attachment',
  'workforce_personal',
  'action_evidence',
  'sync_probe_photo',
  'inspection_evidence',
];
