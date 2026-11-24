import {
  addIsoDays,
  ASSIGNMENT_ENDING_NOTICE_DAYS,
  daysBetween,
  dueReminderThreshold,
  type NotificationParams,
  zonedIsoDate,
} from '@hse/shared';

import type { Statement } from '../../database/unit-of-work';
import type { JobContext, JobResult, ScheduledJob } from '../../platform/jobs';
import { NotificationService } from '../../platform/notification';
import { ReminderService } from '../../platform/reminders';
import { CompanyRepository } from '../company';
import { PermissionResolver, ProjectAudience, WorkforceUserLinks } from '../identity';
import { latestMedical } from './compliance';
import { WorkforceRepository } from './workforce.repository';
import type {
  WorkforceAssignmentRow,
  WorkforceMemberRow,
  WorkforceRecordRow,
} from './workforce.schema';
import { assignmentState } from './workforce-views';

/** Records that may be due: up to 30 days ahead, and a little late (a missed run, FR-6). */
const LATE_DAYS = 2;
const PERSONAL_KINDS = new Set(['document', 'medical']);

interface DueRecord {
  kind: 'record';
  row: WorkforceRecordRow;
  member: WorkforceMemberRow;
  expired: boolean;
}

interface DueAssignment {
  kind: 'assignment';
  row: WorkforceAssignmentRow;
  member: WorkforceMemberRow;
}

type Due = DueRecord | DueAssignment;

/**
 * PLT-20 FR-5 – FR-9 (T-51). Daily: records reaching 30 days, 7 days and the expiry day, and
 * assignments ending within 7 days. Each item and threshold is sent once (reminder key); the
 * day's items become one digest per recipient (O-84), plus a personal notice to the linked user.
 */
export const workforceExpiryJob: ScheduledJob = {
  name: 'workforce.expiry',
  async run({ db, env, logger, clock }: JobContext): Promise<JobResult> {
    const now = clock();
    const repo = new WorkforceRepository(db);
    const reminders = new ReminderService(db, env.JOBS, logger, clock);
    const notifications = new NotificationService(db, clock);
    const result: JobResult = { processed: 0, changed: 0, failed: 0 };

    const utcToday = zonedIsoDate(now, 'UTC');
    const records = await repo.recordsExpiringBetween(
      addIsoDays(utcToday, -LATE_DAYS - 1),
      addIsoDays(utcToday, 31),
    );
    const assignments = await repo.assignmentsEndingBetween(
      addIsoDays(utcToday, -1),
      addIsoDays(utcToday, ASSIGNMENT_ENDING_NOTICE_DAYS + 1),
    );
    const companyIds = [...new Set([...records, ...assignments].map((row) => row.companyId))];
    const companies = await new CompanyRepository(db).findManyByIds(companyIds);

    for (const company of companies) {
      try {
        const today = zonedIsoDate(now, company.timeZone);
        const companyRecords = records.filter((row) => row.companyId === company.id);
        const companyAssignments = assignments.filter((row) => row.companyId === company.id);
        const memberIds = [
          ...new Set(
            [...companyRecords, ...companyAssignments].map((row) => row.workforceMemberId),
          ),
        ];
        const members = new Map(
          (await repo.findMembers(company.id, memberIds))
            // FR-9: archived, terminated and inactive people get no reminders.
            .filter(
              (row) => !row.archivedAt && row.status !== 'terminated' && row.status !== 'inactive',
            )
            .map((row) => [row.id, row]),
        );
        const live = await repo.liveRecordsOf([...members.keys()]);
        const links = await new WorkforceUserLinks(db).usersOf(company.id, [...members.keys()]);

        const due: Due[] = [];
        for (const row of companyRecords) {
          const member = members.get(row.workforceMemberId);
          if (!member || !row.expiresOn) continue;
          // Medical: only the latest check is the person's status.
          if (row.kind === 'medical') {
            const latest = latestMedical(live.filter((r) => r.workforceMemberId === member.id));
            if (latest?.id !== row.id) continue;
          }
          const daysLeft = daysBetween(today, row.expiresOn);
          if (daysLeft < -LATE_DAYS) continue;
          const threshold = dueReminderThreshold(daysLeft);
          if (threshold === null) continue;
          result.processed += 1;
          const linked = links.get(member.id);
          const params: NotificationParams = {
            recordKind: row.kind,
            recordType: row.type,
            recordName: row.name,
            expiresOn: row.expiresOn,
            daysLeft,
            memberName: member.fullName,
          };
          const outcome = await reminders.sendOnce({
            key: `workforce:record:${row.id}:${String(threshold)}`,
            companyId: company.id,
            template: 'workforce.record.expiring',
            emails: [],
            statements: linked?.active
              ? notifications.entries({
                  type: 'workforce.record.expiring',
                  companyId: company.id,
                  entityType: 'workforce_member',
                  entityId: member.id,
                  actorUserId: null,
                  params,
                  recipients: [linked.id],
                })
              : [],
          });
          if (outcome === 'sent') due.push({ kind: 'record', row, member, expired: daysLeft < 0 });
        }
        for (const row of companyAssignments) {
          const member = members.get(row.workforceMemberId);
          if (!member || !row.endDate) continue;
          const state = assignmentState(row, today);
          const daysLeft = daysBetween(today, row.endDate);
          if (state === 'cancelled' || state === 'ended') continue;
          if (daysLeft < 0 || daysLeft > ASSIGNMENT_ENDING_NOTICE_DAYS) continue;
          result.processed += 1;
          const outcome = await reminders.sendOnce({
            key: `workforce:assignment:${row.id}:ending:${row.endDate}`,
            companyId: company.id,
            template: 'workforce.assignment.ending',
            emails: [],
          });
          if (outcome === 'sent') due.push({ kind: 'assignment', row, member });
        }
        if (due.length === 0) continue;

        const statements = await digestStatements(db, clock, company.id, today, due, notifications);
        if (statements.length === 0) continue;
        const outcome = await reminders.sendOnce({
          key: `workforce:digest:${company.id}:${today}:${String(now)}`,
          companyId: company.id,
          template: 'workforce.attention.digest',
          emails: [],
          statements,
        });
        if (outcome === 'sent') result.changed += 1;
      } catch (error) {
        result.failed += 1;
        logger.error('workforce expiry reminders failed', { error, companyId: company.id });
      }
    }
    return result;
  },
};

/** O-84: one digest per recipient, counted from what that recipient may see. */
async function digestStatements(
  db: JobContext['db'],
  clock: () => number,
  companyId: string,
  today: string,
  due: readonly Due[],
  notifications: NotificationService,
): Promise<Statement[]> {
  const resolver = new PermissionResolver(db, clock);
  const audience = new ProjectAudience(db, clock);
  const repo = new WorkforceRepository(db);
  const managers = new Set(
    await audience.companyPermissionHolders(companyId, 'workforce.manage', resolver),
  );
  const personal = new Set(
    await audience.companyPermissionHolders(companyId, 'workforce.personal.view', resolver),
  );

  // Projects each item belongs to: the person's current projects, or the assignment's project.
  const current = await repo.currentAssignments(
    [...new Set(due.map((item) => item.member.id))],
    today,
  );
  const projectsOf = (item: Due): string[] =>
    item.kind === 'assignment'
      ? [item.row.projectId]
      : current
          .filter((row) => row.workforceMemberId === item.member.id)
          .map((row) => row.projectId);
  const projectRecipients = new Map<string, Set<string>>();
  for (const projectId of new Set(due.flatMap(projectsOf))) {
    projectRecipients.set(
      projectId,
      new Set(
        await audience.projectPermissionHolders(
          companyId,
          projectId,
          'projects.workforce.manage',
          resolver,
        ),
      ),
    );
  }

  const tally = new Map<
    string,
    { expired: number; expiring: number; ending: number; projects: Set<string> }
  >();
  for (const item of due) {
    const sensitive = item.kind === 'record' && PERSONAL_KINDS.has(item.row.kind);
    const recipients = new Map<string, string | null>();
    for (const userId of managers) recipients.set(userId, null);
    for (const projectId of projectsOf(item)) {
      for (const userId of projectRecipients.get(projectId) ?? []) {
        if (!recipients.has(userId)) recipients.set(userId, projectId);
      }
    }
    for (const [userId, projectId] of recipients) {
      if (sensitive && !personal.has(userId)) continue;
      const entry = tally.get(userId) ?? {
        expired: 0,
        expiring: 0,
        ending: 0,
        projects: new Set(),
      };
      if (item.kind === 'assignment') entry.ending += 1;
      else if (item.expired) entry.expired += 1;
      else entry.expiring += 1;
      if (projectId && !managers.has(userId)) entry.projects.add(projectId);
      tally.set(userId, entry);
    }
  }

  const statements: Statement[] = [];
  for (const [userId, entry] of tally) {
    const count = entry.expired + entry.expiring + entry.ending;
    if (count === 0) continue;
    const [onlyProject] = entry.projects;
    statements.push(
      ...notifications.entries({
        type: 'workforce.attention.digest',
        companyId,
        projectId:
          !managers.has(userId) && entry.projects.size === 1 ? (onlyProject ?? null) : null,
        entityType: 'workforce',
        entityId: companyId,
        actorUserId: null,
        params: { count, expired: entry.expired, expiring: entry.expiring, ending: entry.ending },
        recipients: [userId],
      }),
    );
  }
  return statements;
}
