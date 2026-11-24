import { REMINDER_DAYS } from '@hse/shared';

import { companyUrl } from '../../core/http/public-urls';
import { NotificationService } from '../../platform/notification';
import type { ReminderOutcome } from '../../platform/reminders';
import type { CompanyRow } from '../company';
import { calendarDaysUntil, dueThreshold, type SubscriptionAccess } from '../subscription';
import type { BillingContext } from './billing.context';

type ReminderTemplate =
  | 'subscription.trial_ending'
  | 'subscription.trial_ended'
  | 'subscription.renewal_due'
  | 'subscription.grace_started'
  | 'subscription.grace_ending'
  | 'subscription.read_only_started';

interface Notice {
  template: ReminderTemplate;
  key: string;
  deadline: number;
  daysLeft: number;
}

/**
 * PLT-15: the date-based notice due now for a subscription, if any. Each has a unique key
 * (T-26), so the daily job can ask every day and each email still goes out once.
 */
export function dueNotice(
  access: SubscriptionAccess,
  timeZone: string,
  now: number,
): Notice | null {
  const id = access.subscription.id;
  const { trialEndsAt, currentPeriodEnd } = access.dates;
  const ahead = (deadline: number, thresholds: readonly number[], name: string) => {
    if (now >= deadline) return null;
    const daysLeft = calendarDaysUntil(now, deadline, timeZone);
    const threshold = dueThreshold(daysLeft, thresholds);
    if (threshold === null) return null;
    return {
      key: `sub:${id}:${name}:${String(threshold)}:${String(deadline)}`,
      deadline,
      daysLeft,
    };
  };

  switch (access.state) {
    case 'trial': {
      // FR-2: no trial reminders once the next period is paid for.
      if (trialEndsAt === null || currentPeriodEnd !== null) return null;
      const due = ahead(trialEndsAt, REMINDER_DAYS.trialEnding, 'trial_ending');
      return due && { template: 'subscription.trial_ending', ...due };
    }
    case 'active': {
      if (currentPeriodEnd === null) return null;
      const due = ahead(currentPeriodEnd, REMINDER_DAYS.renewalDue, 'renewal_due');
      return due && { template: 'subscription.renewal_due', ...due };
    }
    case 'grace': {
      // "Grace started" once; the countdown comes from `graceCountdown` on later days.
      if (currentPeriodEnd === null || access.graceEndsAt === null) return null;
      return {
        template: 'subscription.grace_started',
        key: `sub:${id}:grace_started:${String(currentPeriodEnd)}`,
        deadline: access.graceEndsAt,
        daysLeft: calendarDaysUntil(now, access.graceEndsAt, timeZone),
      };
    }
    case 'read_only': {
      if (currentPeriodEnd === null) {
        if (trialEndsAt === null) return null;
        return {
          template: 'subscription.trial_ended',
          key: `sub:${id}:read_only:${String(trialEndsAt)}`,
          deadline: trialEndsAt,
          daysLeft: 0,
        };
      }
      const since = access.readOnlySince ?? currentPeriodEnd;
      return {
        template: 'subscription.read_only_started',
        key: `sub:${id}:read_only:${String(access.graceEndsAt ?? currentPeriodEnd)}`,
        deadline: since,
        daysLeft: 0,
      };
    }
  }
}

/** The grace countdown reminder, when the "grace started" email has already gone out. */
export function graceCountdown(
  access: SubscriptionAccess,
  timeZone: string,
  now: number,
): Notice | null {
  if (access.state !== 'grace' || access.graceEndsAt === null || now >= access.graceEndsAt) {
    return null;
  }
  const daysLeft = calendarDaysUntil(now, access.graceEndsAt, timeZone);
  const threshold = dueThreshold(daysLeft, REMINDER_DAYS.graceEnding);
  if (threshold === null) return null;
  return {
    template: 'subscription.grace_ending',
    key: `sub:${access.subscription.id}:grace_ending:${String(threshold)}:${String(access.graceEndsAt)}`,
    deadline: access.graceEndsAt,
    daysLeft,
  };
}

/** Sends a notice to every active Company Administrator, once (PLT-15 FR-1). */
export async function sendNotice(
  ctx: BillingContext,
  company: CompanyRow,
  notice: Notice,
): Promise<ReminderOutcome> {
  const admins = await ctx.accounts.listActiveCompanyAdministrators(
    company.id,
    company.defaultLanguage,
  );
  if (admins.length === 0) {
    ctx.deps.logger.warn('no company administrator to notify', {
      companyId: company.id,
      template: notice.template,
    });
    return 'skipped';
  }
  const subscriptionUrl = companyUrl(ctx.deps.config, company.slug, '/settings/subscription');
  return ctx.reminders.sendOnce({
    key: notice.key,
    companyId: company.id,
    template: notice.template,
    statements: new NotificationService(ctx.deps.db, ctx.deps.clock).entries({
      type: 'subscription.reminder',
      companyId: company.id,
      entityType: 'subscription',
      entityId: notice.key,
      actorUserId: null,
      params: {
        reminder: notice.template,
        daysLeft: Math.max(0, notice.daysLeft),
        deadline: notice.deadline,
      },
      recipients: admins.map((admin) => admin.id),
    }),
    emails: admins.map((admin) =>
      ctx.emails.enqueue({
        template: notice.template,
        to: admin.email,
        language: admin.language,
        companyId: company.id,
        data: {
          fullName: admin.fullName,
          companyName: company.name,
          deadline: notice.deadline,
          timeZone: company.timeZone,
          daysLeft: Math.max(0, notice.daysLeft),
          subscriptionUrl,
          bank: { ...ctx.deps.config.billing.bankDetails },
        },
      }),
    ),
  });
}
