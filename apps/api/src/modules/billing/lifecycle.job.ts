import { UnitOfWork } from '../../database/unit-of-work';
import type { JobContext, JobResult, ScheduledJob } from '../../platform/jobs';
import type { CompanyRow } from '../company';
import type { SubscriptionAccess } from '../subscription';
import { BillingContext } from './billing.context';
import { dueNotice, graceCountdown, sendNotice } from './subscription-notices';
import { afterTransition, needsRecording, recordTransition } from './subscription-transitions';

/** Company statuses the lifecycle manages; suspended and unapproved are left alone (FR-5). */
const MANAGED = new Set<CompanyRow['status']>(['active', 'read_only']);

export const SUBSCRIPTION_LIFECYCLE_JOB = 'subscriptions.lifecycle';

/**
 * PLT-10 FR-4 and PLT-15: records every subscription whose effective state changed, keeps the
 * company status in step, and sends the reminders that are due. One company failing never
 * stops the others.
 */
export const subscriptionLifecycleJob: ScheduledJob = {
  name: SUBSCRIPTION_LIFECYCLE_JOB,
  async run(context: JobContext): Promise<JobResult> {
    const ctx = billingContextForJob(context);
    const all = await ctx.subscriptions.accessForAll(ctx.lifecycle);
    const companies = new Map(
      (await ctx.companies.findManyByIds(all.map((access) => access.subscription.companyId))).map(
        (row) => [row.id, row],
      ),
    );

    const result: JobResult = { processed: 0, changed: 0, failed: 0 };
    for (const access of all) {
      const company = companies.get(access.subscription.companyId);
      if (!company || !MANAGED.has(company.status)) continue;
      result.processed += 1;
      try {
        if (await processOne(ctx, access, company)) result.changed += 1;
      } catch (error) {
        result.failed += 1;
        context.logger.error('subscription lifecycle failed for a company', {
          error,
          companyId: company.id,
        });
      }
    }
    return result;
  },
};

async function processOne(
  ctx: BillingContext,
  access: SubscriptionAccess,
  company: CompanyRow,
): Promise<boolean> {
  let changed = false;
  if (
    needsRecording(access) ||
    (access.state === 'read_only') !== (company.status === 'read_only')
  ) {
    await new UnitOfWork(ctx.deps.db).add(...recordTransition(ctx, access, company, null)).commit();
    await afterTransition(ctx, company);
    changed = true;
  }

  const now = ctx.now();
  for (const notice of [
    dueNotice(access, company.timeZone, now),
    graceCountdown(access, company.timeZone, now),
  ]) {
    if (notice && (await sendNotice(ctx, company, notice)) === 'sent') changed = true;
  }
  return changed;
}

export function billingContextForJob(context: JobContext): BillingContext {
  return new BillingContext({
    db: context.db,
    config: context.config,
    meta: { requestId: context.runId, ipAddress: null, userAgent: null },
    logger: context.logger,
    queue: context.env.JOBS,
    cache: context.env.CACHE,
    bucket: context.env.FILES,
    clock: context.clock,
  });
}
