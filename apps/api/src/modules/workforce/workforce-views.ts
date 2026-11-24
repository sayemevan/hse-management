import type {
  AssignmentDto,
  AssignmentState,
  ComplianceSummaryDto,
  ListItemRefDto,
  WorkforceMemberDto,
  WorkforceRowDto,
} from '@hse/shared';

import type { TenantCompany } from '../../core/context/tenant';
import { API_V1_BASE_PATH } from '../../routes/paths';
import { WorkforceUserLinks } from '../identity';
import { type ProjectFacts, ProjectDirectory } from '../project';
import { complianceOf, medicalStatus } from './compliance';
import { listItemRef } from './list.service';
import { canOf, mayRead, type WorkforceAccess } from './workforce-access';
import type { WorkforceContext } from './workforce-context';
import type {
  WorkforceAssignmentRow,
  WorkforceListItemRow,
  WorkforceMemberRow,
  WorkforceRecordRow,
} from './workforce.schema';

export function photoUrlFor(row: { id: string; photoFileId: string | null }): string | null {
  return row.photoFileId
    ? `${API_V1_BASE_PATH}/workforce/${row.id}/photo?v=${row.photoFileId}`
    : null;
}

/** T-55: the state of an assignment on a day. */
export function assignmentState(row: WorkforceAssignmentRow, today: string): AssignmentState {
  if (row.cancelledAt) return 'cancelled';
  if (row.startDate > today) return 'upcoming';
  if (row.endDate && row.endDate < today) return 'ended';
  return 'current';
}

export function refOf(
  items: Map<string, WorkforceListItemRow>,
  id: string | null,
): ListItemRefDto | null {
  const row = id ? items.get(id) : undefined;
  return row ? listItemRef(row) : null;
}

export function assignmentDto(
  row: WorkforceAssignmentRow,
  project: ProjectFacts | undefined,
  items: Map<string, WorkforceListItemRow>,
  today: string,
): AssignmentDto {
  return {
    id: row.id,
    project: { id: row.projectId, code: project?.code ?? '', name: project?.name ?? '' },
    position: refOf(items, row.jobPositionId),
    startDate: row.startDate,
    endDate: row.endDate,
    note: row.note,
    state: assignmentState(row, today),
  };
}

/** Compliance summaries of several people for one reader (PLT-20 FR-2). */
export async function compliances(
  ctx: WorkforceContext,
  access: WorkforceAccess,
  memberIds: readonly string[],
  today: string,
): Promise<{
  summaries: Map<string, ComplianceSummaryDto>;
  records: Map<string, WorkforceRecordRow[]>;
}> {
  const [records, contacts] = await Promise.all([
    ctx.repo.liveRecordsOf(memberIds),
    ctx.repo.contactCounts(memberIds),
  ]);
  const byMember = new Map<string, WorkforceRecordRow[]>();
  for (const row of records) {
    const list = byMember.get(row.workforceMemberId) ?? [];
    list.push(row);
    byMember.set(row.workforceMemberId, list);
  }
  const summaries = new Map<string, ComplianceSummaryDto>();
  for (const id of memberIds) {
    summaries.set(
      id,
      complianceOf(byMember.get(id) ?? [], contacts.get(id) ?? 0, {
        today,
        personal: mayRead(access, id, 'personal'),
        contacts: mayRead(access, id, 'contacts'),
      }),
    );
  }
  return { summaries, records: byMember };
}

/** Directory rows (US-024 FR-1). */
export async function memberRows(
  ctx: WorkforceContext,
  tenant: TenantCompany,
  access: WorkforceAccess,
  rows: readonly WorkforceMemberRow[],
): Promise<WorkforceRowDto[]> {
  const today = ctx.today(tenant);
  const ids = rows.map((row) => row.id);
  const [{ summaries }, items, current] = await Promise.all([
    compliances(ctx, access, ids, today),
    ctx.lists.byIds(
      tenant.id,
      rows.map((row) => row.jobPositionId),
    ),
    ctx.repo.currentAssignments(ids, today),
  ]);
  const projects = await new ProjectDirectory(ctx.db).getMany(
    tenant.id,
    current.map((row) => row.projectId),
  );
  return rows.map((row) => toRow(row, items, summaries, current, projects));
}

function toRow(
  row: WorkforceMemberRow,
  items: Map<string, WorkforceListItemRow>,
  summaries: Map<string, ComplianceSummaryDto>,
  current: readonly WorkforceAssignmentRow[],
  projects: Map<string, ProjectFacts>,
): WorkforceRowDto {
  const summary = summaries.get(row.id);
  if (!summary) throw new Error('missing compliance summary');
  return {
    id: row.id,
    fullName: row.fullName,
    altName: row.altName,
    employeeId: row.employeeId,
    category: row.category,
    position: refOf(items, row.jobPositionId),
    employer: row.employer,
    status: row.status,
    photoUrl: photoUrlFor(row),
    archived: row.archivedAt !== null,
    compliance: summary,
    currentProjects: current
      .filter((assignment) => assignment.workforceMemberId === row.id)
      .flatMap((assignment) => {
        const project = projects.get(assignment.projectId);
        return project ? [{ id: project.id, code: project.code }] : [];
      }),
  };
}

/** The profile (US-024 FR-3, US-028 status). */
export async function memberDto(
  ctx: WorkforceContext,
  tenant: TenantCompany,
  access: WorkforceAccess,
  row: WorkforceMemberRow,
): Promise<WorkforceMemberDto> {
  const today = ctx.today(tenant);
  const [{ summaries, records }, assignments, linked] = await Promise.all([
    compliances(ctx, access, [row.id], today),
    ctx.repo.assignmentsOfMembers([row.id]),
    new WorkforceUserLinks(ctx.db).usersOf(tenant.id, [row.id]),
  ]);
  const items = await ctx.lists.byIds(tenant.id, [
    row.jobPositionId,
    ...assignments.map((assignment) => assignment.jobPositionId),
  ]);
  const projects = await new ProjectDirectory(ctx.db).getMany(
    tenant.id,
    assignments.map((assignment) => assignment.projectId),
  );
  const open = assignments.filter((assignment) => {
    const state = assignmentState(assignment, today);
    return state === 'current' || state === 'upcoming';
  });
  const user = linked.get(row.id);
  return {
    ...toRow(
      row,
      items,
      summaries,
      open.filter((assignment) => assignmentState(assignment, today) === 'current'),
      projects,
    ),
    nationality: row.nationality,
    department: row.department,
    mobile: row.mobile,
    email: row.email,
    statusSince: row.statusSince,
    statusReason: row.statusReason,
    createdAt: row.createdAt.getTime(),
    medical: medicalStatus(records.get(row.id) ?? [], today),
    linkedUser: user ? { id: user.id, fullName: user.fullName } : null,
    currentAssignments: open.map((assignment) =>
      assignmentDto(assignment, projects.get(assignment.projectId), items, today),
    ),
    can: canOf(access, row),
  };
}
