import { UnitOfWork } from '../../database/unit-of-work';
import type { RegistrationContext } from './registration.context';

export interface RegistrationMaintenanceResult {
  removedUnverified: number;
  closedRejected: number;
}

/**
 * Daily housekeeping (O-15):
 * - applications never verified within the retention period are deleted with their tokens;
 * - rejected applications not resubmitted within the resubmission window are closed,
 *   their tokens invalidated and their subdomain released (the record stays for history).
 */
export async function runRegistrationMaintenance(
  ctx: RegistrationContext,
): Promise<RegistrationMaintenanceResult> {
  const now = ctx.now();
  const { registration } = ctx.deps.config;

  const unverified = await ctx.registrations.unverifiedCreatedBefore(
    now - registration.unverifiedRetentionMs,
  );
  if (unverified.length > 0) {
    await new UnitOfWork(ctx.deps.db)
      .add(ctx.tokens.deleteForSubjects(unverified), ctx.registrations.deleteMany(unverified))
      .commit();
  }

  const expired = await ctx.registrations.rejectedBefore(now - registration.resubmitTokenTtlMs);
  if (expired.length > 0) {
    const work = new UnitOfWork(ctx.deps.db).add(ctx.registrations.closeMany(expired, now));
    for (const id of expired) {
      work.add(
        ctx.tokens.invalidateAll('registration_resubmit', id),
        ctx.audit.entry({
          action: 'registration.closed',
          actorUserId: null,
          entityType: 'company_registration',
          entityId: id,
          newValue: { reason: 'resubmission_window_expired' },
        }),
      );
    }
    await work.commit();
  }

  ctx.deps.logger.info('registration maintenance done', {
    removedUnverified: unverified.length,
    closedRejected: expired.length,
  });
  return { removedUnverified: unverified.length, closedRejected: expired.length };
}
