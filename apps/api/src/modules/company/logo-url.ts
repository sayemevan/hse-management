import { API_V1_BASE_PATH } from '../../routes/paths';

/**
 * Same-origin address of a company's logo (US-014). The file id is a cache buster: a new
 * logo gets a new URL, so the 1-hour cache never shows an old logo.
 */
export function logoUrlFor(logoFileId: string | null): string | null {
  return logoFileId ? `${API_V1_BASE_PATH}/company/logo?v=${logoFileId}` : null;
}
