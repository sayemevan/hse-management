import type { PaymentDto, SubmitPaymentFields, SubscriptionSummaryDto } from '@hse/shared';

import { authorizedRequest } from '@/modules/auth/auth-session';

/** The company's subscription page and payment proofs (PLT-13). */
export const billingService = {
  async summary(): Promise<SubscriptionSummaryDto> {
    return (await authorizedRequest<SubscriptionSummaryDto>('/subscription')).data;
  },

  async payments(): Promise<PaymentDto[]> {
    return (await authorizedRequest<PaymentDto[]>('/subscription/payments')).data;
  },

  async submit(fields: SubmitPaymentFields, receipt: File): Promise<PaymentDto> {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value !== '') form.set(name, value);
    }
    form.set('file', receipt);
    return (
      await authorizedRequest<PaymentDto>('/subscription/payments', { method: 'POST', body: form })
    ).data;
  },

  async withdraw(id: string): Promise<void> {
    await authorizedRequest<null>(`/subscription/payments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};
