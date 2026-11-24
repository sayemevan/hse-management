import type { Language, PaymentDto } from '@hse/shared';

import { type PaymentRow, planName, type PlanRow, toRiyals } from '../subscription';

/** Plan ids a list of payments refers to, for one `plansById` lookup. */
export function planIdsOf(rows: readonly PaymentRow[]): string[] {
  return rows.flatMap((row) =>
    row.confirmedPlanId ? [row.planId, row.confirmedPlanId] : [row.planId],
  );
}

export function toPaymentDto(
  row: PaymentRow,
  plans: Map<string, PlanRow>,
  language: Language,
): PaymentDto {
  const asked = plans.get(row.planId);
  const confirmed = row.confirmedPlanId ? plans.get(row.confirmedPlanId) : undefined;
  return {
    id: row.id,
    planCode: asked?.code ?? '',
    planName: asked ? planName(asked, language) : '',
    billingCycle: row.billingCycle,
    amount: toRiyals(row.amountHalalas),
    transferredOn: row.transferredOn,
    reference: row.reference,
    status: row.status,
    submittedAt: row.submittedAt.getTime(),
    reviewedAt: row.reviewedAt?.getTime() ?? null,
    rejectionReason: row.rejectionReason,
    confirmedPlanName: confirmed ? planName(confirmed, language) : null,
    confirmedBillingCycle: row.confirmedBillingCycle,
    confirmedAmount:
      row.confirmedAmountHalalas === null ? null : toRiyals(row.confirmedAmountHalalas),
    periodStart: row.periodStart?.getTime() ?? null,
    periodEnd: row.periodEnd?.getTime() ?? null,
  };
}
