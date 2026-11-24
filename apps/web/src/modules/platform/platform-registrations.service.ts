import type {
  ApprovalResultDto,
  PaginationMeta,
  RegistrationDetailDto,
  RegistrationStatus,
  RegistrationSummaryDto,
} from '@hse/shared';

import { authorizedRequest } from '@/modules/auth/auth-session';

export interface RegistrationPage {
  items: RegistrationSummaryDto[];
  meta: PaginationMeta;
}

const base = '/platform/registrations';

/** The System Owner's review queue (US-011.3, US-011.4). */
export const platformRegistrationsService = {
  async list(
    status: RegistrationStatus | null,
    page: number,
    pageSize = 20,
  ): Promise<RegistrationPage> {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) query.set('status', status);
    const response = await authorizedRequest<RegistrationSummaryDto[]>(`${base}?${query}`);
    const meta = response.meta ?? {};
    return {
      items: response.data,
      meta: {
        page: meta.page ?? page,
        pageSize: meta.pageSize ?? pageSize,
        total: meta.total ?? response.data.length,
        totalPages: meta.totalPages ?? 1,
      },
    };
  },

  async detail(id: string): Promise<RegistrationDetailDto> {
    return (await authorizedRequest<RegistrationDetailDto>(`${base}/${encodeURIComponent(id)}`))
      .data;
  },

  async approve(id: string, planCode?: string): Promise<ApprovalResultDto> {
    return (
      await authorizedRequest<ApprovalResultDto>(`${base}/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        body: { phoneConfirmed: true, ...(planCode ? { planCode } : {}) },
      })
    ).data;
  },

  async reject(id: string, reason: string): Promise<void> {
    await authorizedRequest<{ status: 'rejected' }>(`${base}/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: { reason },
    });
  },
};
