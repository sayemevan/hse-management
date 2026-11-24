import { COMPANY_WIDE_ROLES, type ProjectRoleState, zonedIsoDate } from '@hse/shared';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { user, type UserRoleRow } from './identity.schema';
import { RoleRepository } from './role.repository';
import { type UserSummary, userSummaries } from './user-names';

export interface MemberRow {
  assignmentId: string;
  user: UserSummary;
  roleCode: string;
  validFrom: string | null;
  validUntil: string | null;
  state: ProjectRoleState;
}

export interface ProjectMembersView {
  team: MemberRow[];
  past: MemberRow[];
  companyWide: { user: UserSummary; companyRoleCode: string }[];
}

export interface CandidateRow {
  id: string;
  fullName: string;
  email: string;
  status: string;
  onProject: boolean;
  companyWide: boolean;
}

const LISTED_STATUSES = ['active', 'pending_invitation'] as const;

/** US-022 FR-1, FR-2: who works on a project, and who could be added. */
export class ProjectMembership {
  private readonly roles: RoleRepository;

  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {
    this.roles = new RoleRepository(db);
  }

  async view(companyId: string, projectId: string, timeZone: string): Promise<ProjectMembersView> {
    const now = this.clock();
    const [projectRows, wideRows] = await Promise.all([
      this.roles.listForProject(companyId, projectId),
      this.roles.listCompanyRolesInForce(companyId, COMPANY_WIDE_ROLES, now),
    ]);
    const users = await userSummaries(this.db, [
      ...projectRows.map((row) => row.userId),
      ...wideRows.map((row) => row.userId),
    ]);
    const listed = (id: string) => {
      const summary = users.get(id);
      return summary && !summary.former && summary.companyId === companyId ? summary : undefined;
    };
    const members = projectRows.flatMap((row) => {
      const summary = listed(row.userId);
      return summary ? [toMember(row, summary, timeZone, now)] : [];
    });
    const byName = (a: MemberRow, b: MemberRow) => a.user.fullName.localeCompare(b.user.fullName);
    return {
      team: members.filter((row) => row.state !== 'ended').sort(byName),
      past: members.filter((row) => row.state === 'ended').reverse(),
      companyWide: wideRows
        .flatMap((row) => {
          const summary = listed(row.userId);
          return summary?.status === 'active'
            ? [{ user: summary, companyRoleCode: row.roleCode }]
            : [];
        })
        .sort((a, b) => a.user.fullName.localeCompare(b.user.fullName)),
    };
  }

  /** O-68: the company's active and invited users, flagged when they can't be added. */
  async candidates(companyId: string, projectId: string, search?: string): Promise<CandidateRow[]> {
    const now = this.clock();
    const pattern = search ? `%${search.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db
      .select({ id: user.id, fullName: user.fullName, email: user.email, status: user.status })
      .from(user)
      .where(
        and(
          eq(user.companyId, companyId),
          isNull(user.deletedAt),
          inArray(user.status, [...LISTED_STATUSES]),
          pattern
            ? or(
                sql`lower(${user.fullName}) like ${pattern} escape '\\'`,
                sql`lower(${user.email}) like ${pattern} escape '\\'`,
              )
            : undefined,
        ),
      )
      .orderBy(asc(user.fullName))
      .limit(100)
      .all();
    const [projectRows, wideRows] = await Promise.all([
      this.roles.listForProject(companyId, projectId),
      this.roles.listCompanyRolesInForce(companyId, COMPANY_WIDE_ROLES, now),
    ]);
    const onProject = new Set(
      projectRows.filter((row) => !ended(row, now)).map((row) => row.userId),
    );
    const wide = new Set(wideRows.map((row) => row.userId));
    return rows.map((row) => ({
      ...row,
      onProject: onProject.has(row.id),
      companyWide: wide.has(row.id),
    }));
  }
}

function ended(row: UserRoleRow, now: number): boolean {
  return row.validUntil !== null && row.validUntil.getTime() <= now;
}

function toMember(
  row: UserRoleRow,
  summary: UserSummary,
  timeZone: string,
  now: number,
): MemberRow {
  const from = row.validFrom?.getTime() ?? null;
  const until = row.validUntil?.getTime() ?? null;
  const state: ProjectRoleState =
    until !== null && until <= now ? 'ended' : from !== null && from > now ? 'scheduled' : 'active';
  return {
    assignmentId: row.id,
    user: summary,
    roleCode: row.roleCode,
    validFrom: from === null ? null : zonedIsoDate(from, timeZone),
    validUntil: until === null ? null : zonedIsoDate(until - 1, timeZone),
    state,
  };
}
