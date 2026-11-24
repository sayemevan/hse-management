import type { SubscriptionState } from '@hse/shared';

import type { Statement } from '../../database/unit-of-work';
import type { CompanyRow } from '../company';
import type { SubscriptionAccess } from '../subscription';
import type { BillingContext } from './billing.context';

const AUDIT_BY_STATE: Partial<
  Record<SubscriptionState, 'subscription.grace_started' | 'subscription.read_only_started'>
> = {
  grace: 'subscription.grace_started',
  read_only: 'subscription.read_only_started',
};

/** Whether the stored record lags behind the effective state or a due plan switch. */
export function needsRecording(access: SubscriptionAccess): boolean {
  const row = access.subscription;
  return access.state !== row.status || access.plan.id !== row.planId;
}

/**
 * PLT-10 FR-4 / T-23: the statements that record a subscription's effective state, keep the
 * company status in step and audit the change. Commit them in one batch, then call
 * `afterCommit` so the tenant cache shows the change at once.
 */
export function recordTransition(
  ctx: BillingContext,
  access: SubscriptionAccess,
  company: CompanyRow,
  actorId: string | null,
): Statement[] {
  const row = access.subscription;
  const statements: Statement[] = [ctx.subscriptions.recordState(access, actorId)];
  const now = ctx.now();

  const companyStatus = access.state === 'read_only' ? 'read_only' : 'active';
  if (company.status !== companyStatus) {
    statements.push(ctx.companies.setAccessStatus(company.id, companyStatus, actorId, now));
  }

  const action =
    AUDIT_BY_STATE[access.state] ??
    (row.status === 'read_only' ? 'subscription.read_only_ended' : null);
  if (action && access.state !== row.status) {
    statements.push(
      ctx.audit.entry({
        action,
        actorUserId: actorId,
        companyId: company.id,
        entityType: 'subscription',
        entityId: row.id,
        oldValue: { status: row.status },
        newValue: {
          status: access.state,
          graceEndsAt: access.state === 'grace' ? access.graceEndsAt : null,
        },
      }),
    );
  }
  if (access.plan.id !== row.planId) {
    statements.push(
      ctx.audit.entry({
        action: 'subscription.plan_changed',
        actorUserId: actorId,
        companyId: company.id,
        entityType: 'subscription',
        entityId: row.id,
        oldValue: { planId: row.planId },
        newValue: { planId: access.plan.id },
      }),
    );
  }
  return statements;
}

export async function afterTransition(ctx: BillingContext, company: CompanyRow): Promise<void> {
  await ctx.directory.invalidate(company.slug);
}
