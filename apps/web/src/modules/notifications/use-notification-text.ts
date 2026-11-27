'use client';

import type { NotificationDto } from '@hse/shared';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { useDateFormat } from '@/modules/i18n/use-date-format';
import { usePositionName, useRecordLabel } from '@/modules/workforce/workforce-ui';

/** Unicode LEFT-TO-RIGHT ISOLATE and POP DIRECTIONAL ISOLATE, for codes inside sentences. */
const ltr = (text: string) => `${String.fromCharCode(0x2066)}${text}${String.fromCharCode(0x2069)}`;

/**
 * The sentence of a notification in the reader's language, from its type and parameters
 * (T-40). Old notifications follow a language switch because nothing is stored as text.
 */
export function useNotificationText(): (notification: NotificationDto) => string {
  const t = useTranslations('notifications.types');
  const roles = useTranslations('roles');
  const statuses = useTranslations('projectStatus');
  const { calendarDate, date } = useDateFormat();
  const recordLabel = useRecordLabel();
  const positionName = usePositionName();

  return useCallback(
    (notification: NotificationDto) => {
      const p = notification.params;
      const project = p.projectCode ? `${ltr(p.projectCode)} · ${p.projectName ?? ''}` : '';
      const role = p.roleCode ? roles(p.roleCode as 'worker') : '';
      const status = p.status ? statuses(p.status as 'active') : '';
      switch (notification.type) {
        case 'project.member.added':
          return t('memberAdded', { project, role });
        case 'project.member.joined':
          return t('memberJoined', { project, role, member: p.memberName ?? '' });
        case 'project.member.role_changed':
          return t('memberRoleChanged', { project, role });
        case 'project.member.removed':
          return t('memberRemoved', { project });
        case 'project.member.access_ending':
          return p.self
            ? t('accessEndingSelf', { project, date: calendarDate(p.validUntil ?? null) })
            : t('accessEndingOther', {
                project,
                member: p.memberName ?? '',
                date: calendarDate(p.validUntil ?? null),
              });
        case 'company.role.changed':
          return t('companyRoleChanged', { role });
        case 'project.status.changed':
          return t('statusChanged', { project, status });
        case 'project.archived':
          return t('archived', { project });
        case 'project.restored':
          return t('restored', { project, status });
        case 'role.permissions.changed':
          return p.reset ? t('permissionsReset', { role }) : t('permissionsChanged', { role });
        case 'user.locked':
          return t('userLocked', { user: p.userName ?? '' });
        case 'subscription.reminder':
          return t('subscriptionReminder', {
            reminder: (p.reminder ?? '').replace('subscription.', ''),
            days: p.daysLeft ?? 0,
            date: date(p.deadline ?? null),
          });
        case 'workforce.attention.digest':
          return t('workforceDigest', {
            count: p.count ?? 0,
            expired: p.expired ?? 0,
            expiring: p.expiring ?? 0,
            ending: p.ending ?? 0,
          });
        case 'workforce.record.expiring':
          return t('workforceRecordExpiring', {
            record: recordLabel({
              kind: (p.recordKind ?? 'training') as 'training',
              type: p.recordType ?? null,
              name: p.recordName ?? null,
            }),
            days: p.daysLeft ?? 0,
            date: calendarDate(p.expiresOn ?? null),
          });
        case 'workforce.assignment.added':
          return t('workforceAssigned', {
            project,
            position: p.positionName
              ? positionName({ id: '', name: p.positionName, seedKey: p.positionKey ?? null })
              : '',
            date: calendarDate(p.startDate ?? null),
          });
        // Sprint 8 (PLT-23 § Notifications)
        case 'action.assigned':
        case 'action.unassigned':
        case 'action.collaborator_added':
        case 'action.due_tomorrow':
        case 'action.verification_needed':
        case 'action.verified':
        case 'action.closed':
        case 'action.owner_lost_access':
          return t(notification.type.replace('action.', 'action_') as 'action_assigned', {
            ref: ltr(p.actionReference ?? ''),
            title: p.actionTitle ?? '',
          });
        case 'action.overdue':
          return t('action_overdue', {
            ref: ltr(p.actionReference ?? ''),
            title: p.actionTitle ?? '',
            days: p.daysOverdue ?? 1,
          });
        case 'action.sent_back':
        case 'action.voided':
          return t(notification.type.replace('action.', 'action_') as 'action_sent_back', {
            ref: ltr(p.actionReference ?? ''),
            title: p.actionTitle ?? '',
            reason: p.reason ?? '',
          });
        case 'action.due_date_changed':
          return t('action_due_date_changed', {
            ref: ltr(p.actionReference ?? ''),
            title: p.actionTitle ?? '',
            date: calendarDate(p.dueOn ?? null),
          });
        case 'action.comment_added':
          return t('action_comment_added', {
            ref: ltr(p.actionReference ?? ''),
            title: p.actionTitle ?? '',
            count: p.count ?? 1,
          });
        case 'action.due_digest':
          return t('action_due_digest', {
            overdue: p.overdue ?? 0,
            dueToday: p.dueToday ?? 0,
            critical: p.critical ?? 0,
          });
        // Sprint 9 (O-131)
        case 'sync.conflict':
          return t(p.again ? 'sync_conflict_again' : 'sync_conflict', { record: p.recordLabel ?? '' });
        case 'workforce.member.suspended':
          return t('workforceSuspended', {
            member: p.memberName ?? '',
            project,
            date: calendarDate(p.since ?? null),
          });
      }
    },
    [t, roles, statuses, calendarDate, date, recordLabel, positionName],
  );
}

/** "5 min ago", "2 h ago", "3 days ago", or the date after a week. */
export function useRelativeTime(): (time: number) => string {
  const t = useTranslations('notifications');
  const { dateTime } = useDateFormat();
  return useCallback(
    (time: number) => {
      const minutes = Math.floor((Date.now() - time) / 60_000);
      if (minutes < 1) return t('justNow');
      if (minutes < 60) return t('minutesAgo', { count: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('hoursAgo', { count: hours });
      const days = Math.floor(hours / 24);
      if (days < 7) return t('daysAgo', { count: days });
      return dateTime(time);
    },
    [t, dateTime],
  );
}
