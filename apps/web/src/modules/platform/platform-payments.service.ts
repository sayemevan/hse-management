import type {
  BillingCycle,
  JobRunDto,
  PaginationMeta,
  PaymentDto,
  PaymentStatus,
  PlatformPaymentDetailDto,
  PlatformPaymentSummaryDto,
  PlatformSubscriptionDto,
  SubscriptionState,
} from '@hse/shared';

import { authorizedBlob, authorizedRequest } from '@/modules/auth/auth-session';

export interface PaymentPage {
  items: PlatformPaymentSummaryDto[];
  meta: PaginationMeta;
  pendingCount: number;
}

const base = '/platform/payments';

/** The System Owner's payment queue and the subscriptions overview (PLT-14). */
export const platformPaymentsService = {
  async list(status: PaymentStatus, page: number, pageSize = 20): Promise<PaymentPage> {
    const query = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
    const response = await authorizedRequest<PlatformPaymentSummaryDto[]>(`${base}?${query}`);
    const meta = response.meta ?? {};
    return {
      items: response.data,
      meta: {
        page: meta.page ?? page,
        pageSize: meta.pageSize ?? pageSize,
        total: meta.total ?? response.data.length,
        totalPages: meta.totalPages ?? 1,
      },
      pendingCount: typeof meta.pendingCount === 'number' ? meta.pendingCount : 0,
    };
  },

  async detail(id: string): Promise<PlatformPaymentDetailDto> {
    return (await authorizedRequest<PlatformPaymentDetailDto>(`${base}/${encodeURIComponent(id)}`))
      .data;
  },

  /** The receipt as a blob URL (the request needs the access token, so no plain link). */
  async receiptUrl(id: string): Promise<string> {
    return URL.createObjectURL(await authorizedBlob(`${base}/${encodeURIComponent(id)}/file`));
  },

  async confirm(
    id: string,
    changes: { planCode?: string; billingCycle?: BillingCycle; amountReceived?: string },
  ): Promise<PaymentDto> {
    return (
      await authorizedRequest<PaymentDto>(`${base}/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        body: changes,
      })
    ).data;
  },

  async reject(id: string, reason: string): Promise<void> {
    await authorizedRequest<{ status: 'rejected' }>(`${base}/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: { reason },
    });
  },

  /** When the daily subscription job last ran (PLT-14 FR-8). */
  async lastLifecycleRun(): Promise<JobRunDto | null> {
    const runs = (await authorizedRequest<JobRunDto[]>('/platform/jobs')).data;
    return runs.find((job) => job.name === 'subscriptions.lifecycle') ?? null;
  },

  async subscriptions(state: SubscriptionState | null): Promise<PlatformSubscriptionDto[]> {
    const query = state ? `?state=${state}` : '';
    return (await authorizedRequest<PlatformSubscriptionDto[]>(`/platform/subscriptions${query}`))
      .data;
  },
};
