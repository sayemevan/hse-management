import {
  addIsoDays,
  ASSIGNABLE_STATUSES,
  type AssignWorkforceRequest,
  generateId,
  type ProjectWorkforcePageDto,
  type UpdateAssignmentRequest,
  type WorkforceCandidatesDto,
} from '@hse/shared';
import { eq } from 'drizzle-orm';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import type { Statement } from '../../database/unit-of-work';
import { UnitOfWork } from '../../database/unit-of-work';
import { changedFields } from '../../platform/activity';
import { WorkforceUserLinks } from '../identity';
import type { ProjectRow } from '../project';
import { ProjectDirectory } from '../project';
import { listItemRef } from './list.service';
import type { WorkforceAccess } from './workforce-access';
import type { WorkforceContext } from './workforce-context';
import {
  AssignmentOverlapError,
  BulkAssignRefusedError,
  NotAssignableError,
  ProjectClosedForAssignmentError,
  WorkforceArchivedError,
  WorkforceProjectArchivedError,
} from './workforce.errors';
import {
  workforceAssignment,
  type WorkforceAssignmentRow,
  type WorkforceListItemRow,
  type WorkforceMemberRow,
} from './workforce.schema';
import { assignmentDto, assignmentState, compliances, photoUrlFor, refOf } from './workforce-views';

/** Two date ranges overlap (open end = forever). */
function overlaps(
  a: { startDate: string; endDate: string | null },
  b: { startDate: string; endDate: string | null },
): boolean {
  return a.startDate <= (b.endDate ?? '9999-12-31') && b.startDate <= (a.endDate ?? '9999-12-31');
}

/** US-025 rules: new assignments only on projects that aren't Completed or Archived. */
function assertProjectOpen(project: ProjectRow): void {
  if (project.status === 'archived') throw new WorkforceProjectArchivedError();
  if (project.status === 'completed') throw new ProjectClosedForAssignmentError();
}

function assertProjectWritable(project: ProjectRow): void {
  if (project.status === 'archived') throw new WorkforceProjectArchivedError();
}

/** US-025: people on projects. */
export class AssignmentService {
  constructor(private readonly ctx: WorkforceContext) {}

  /** FR-1. */
  async list(
    tenant: TenantCompany,
    project: ProjectRow,
    access: WorkforceAccess,
    perms: { manage: boolean },
    query: {
      search?: string;
      state: 'current' | 'upcoming' | 'ended' | 'all';
      position?: string;
      attention: boolean;
      page: number;
    },
  ): Promise<ProjectWorkforcePageDto> {
    const today = this.ctx.today(tenant);
    const { rows, total } = await this.ctx.repo.projectAssignments(
      tenant.id,
      project.id,
      {
        state: query.state,
        attention: query.attention,
        page: query.page,
        ...(query.position ? { positionId: query.position } : {}),
        ...(query.search ? { search: query.search } : {}),
      },
      { today, personal: access.personal, contacts: access.contacts },
    );
    const memberIds = [...new Set(rows.map((row) => row.member.id))];
    const [{ summaries }, items] = await Promise.all([
      compliances(this.ctx, access, memberIds, today),
      this.ctx.lists.byIds(
        tenant.id,
        rows.map((row) => row.assignment.jobPositionId),
      ),
    ]);
    return {
      page: query.page,
      total,
      pageSize: 25,
      canManage: perms.manage && project.status !== 'archived',
      canAssign: perms.manage && project.status !== 'archived' && project.status !== 'completed',
      canOpenProfiles: access.view,
      items: rows.map(({ assignment, member }) => {
        const compliance = summaries.get(member.id);
        if (!compliance) throw new Error('missing compliance');
        return {
          assignmentId: assignment.id,
          member: {
            id: member.id,
            fullName: member.fullName,
            altName: member.altName,
            employeeId: member.employeeId,
            photoUrl: photoUrlFor(member),
            status: member.status,
            compliance,
          },
          position: refOf(items, assignment.jobPositionId),
          startDate: assignment.startDate,
          endDate: assignment.endDate,
          note: assignment.note,
          state: assignmentState(assignment, today),
        };
      }),
    };
  }

  /** FR-2. */
  async candidates(
    tenant: TenantCompany,
    project: ProjectRow,
    access: WorkforceAccess,
    search: string | undefined,
  ): Promise<WorkforceCandidatesDto> {
    const today = this.ctx.today(tenant);
    const rows = await this.ctx.repo.candidates(tenant.id, search);
    const ids = rows.map((row) => row.id);
    const [{ summaries }, items, onProject] = await Promise.all([
      compliances(this.ctx, access, ids, today),
      this.ctx.lists.byIds(
        tenant.id,
        rows.map((row) => row.jobPositionId),
      ),
      this.ctx.repo.assignmentsOn(project.id, ids),
    ]);
    return {
      items: rows.map((row) => {
        const compliance = summaries.get(row.id);
        if (!compliance) throw new Error('missing compliance');
        return {
          id: row.id,
          fullName: row.fullName,
          altName: row.altName,
          employeeId: row.employeeId,
          position: refOf(items, row.jobPositionId),
          employer: row.employer,
          status: row.status,
          compliance,
          onProject: onProject.some((assignment) => {
            const state = assignmentState(assignment, today);
            return (
              assignment.workforceMemberId === row.id &&
              (state === 'current' || state === 'upcoming')
            );
          }),
        };
      }),
    };
  }

  /** FR-3: up to 50 people, all or none (O-92). */
  async assign(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    input: AssignWorkforceRequest,
  ): Promise<number> {
    assertProjectOpen(project);
    const today = this.ctx.today(tenant);
    if (input.startDate < addIsoDays(today, -365)) {
      throw new ValidationError([{ path: 'startDate', message: 'startTooEarly' }]);
    }
    const ids = [...new Set(input.memberIds)];
    const members = await this.ctx.repo.findMembers(tenant.id, ids);
    if (members.length !== ids.length) throw new NotFoundError();
    let position: WorkforceListItemRow | null = null;
    if (input.positionId !== 'own') {
      position = await this.ctx.lists.requireUsable(tenant.id, 'job_position', input.positionId);
    }
    const range = { startDate: input.startDate, endDate: input.endDate ?? null };
    const existing = await this.ctx.repo.assignmentsOn(project.id, ids);
    const refused: { memberId: string; name: string; reason: string; from?: string }[] = [];
    for (const member of members) {
      if (member.archivedAt) {
        refused.push({ memberId: member.id, name: member.fullName, reason: 'archived' });
      } else if (!ASSIGNABLE_STATUSES.includes(member.status)) {
        refused.push({ memberId: member.id, name: member.fullName, reason: member.status });
      } else {
        const clash = existing.find(
          (row) => row.workforceMemberId === member.id && overlaps(row, range),
        );
        if (clash) {
          refused.push({
            memberId: member.id,
            name: member.fullName,
            reason: 'overlap',
            from: clash.startDate,
          });
        }
      }
    }
    if (refused.length > 0) {
      const [only] = refused;
      if (members.length === 1 && only) {
        if (only.reason === 'overlap') throw new AssignmentOverlapError(only.from ?? '');
        if (only.reason === 'archived') throw new WorkforceArchivedError();
        throw new NotAssignableError(only.reason);
      }
      throw new BulkAssignRefusedError(refused);
    }

    const now = new Date(this.ctx.now());
    const work = new UnitOfWork(this.ctx.db);
    const links = await new WorkforceUserLinks(this.ctx.db).usersOf(tenant.id, ids);
    const items = await this.ctx.lists.byIds(
      tenant.id,
      members.map((member) => member.jobPositionId),
    );
    for (const member of members) {
      const positionId = position?.id ?? member.jobPositionId;
      const positionRow = position ?? items.get(member.jobPositionId) ?? null;
      const positionRef = positionRow ? listItemRef(positionRow) : null;
      const id = generateId();
      work.add(
        this.ctx.db.insert(workforceAssignment).values({
          id,
          companyId: tenant.id,
          workforceMemberId: member.id,
          projectId: project.id,
          jobPositionId: positionId,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          note: input.note ?? null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        ...this.ctx.record(principal, member, {
          audit: 'workforce.assignment.created',
          activity: 'workforce.assigned',
          entityType: 'workforce_assignment',
          entityId: id,
          projectId: project.id,
          newValue: {
            projectId: project.id,
            positionId,
            startDate: input.startDate,
            endDate: input.endDate ?? null,
            bulk: members.length,
          },
          changes: {
            before: {},
            after: { startDate: input.startDate, endDate: input.endDate ?? null },
          },
          snapshot: {
            projectCode: project.code,
            projectName: project.name,
            positionName: positionRef?.name ?? null,
            positionKey: positionRef?.seedKey ?? null,
          },
        }),
      );
      // US-025 FR-7: the linked user hears about it.
      const linked = links.get(member.id);
      if (linked?.active) {
        work.add(
          ...this.ctx.notifications.entries({
            type: 'workforce.assignment.added',
            companyId: tenant.id,
            projectId: project.id,
            entityType: 'workforce_member',
            entityId: member.id,
            actorUserId: principal.userId,
            params: {
              projectCode: project.code,
              projectName: project.name,
              positionName: positionRef?.name ?? null,
              positionKey: positionRef?.seedKey ?? null,
              startDate: input.startDate,
            },
            recipients: [linked.id],
          }),
        );
      }
    }
    await work.commit();
    return members.length;
  }

  /** FR-4: change position, dates, note. */
  async update(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    assignmentId: string,
    input: UpdateAssignmentRequest,
  ): Promise<void> {
    assertProjectWritable(project);
    const { assignment, member } = await this.required(tenant, project, assignmentId);
    const today = this.ctx.today(tenant);
    const state = assignmentState(assignment, today);
    if (state === 'cancelled') throw new ValidationError([{ path: 'id', message: 'cancelled' }]);
    if (
      input.startDate !== undefined &&
      input.startDate !== assignment.startDate &&
      state !== 'upcoming'
    ) {
      throw new ValidationError([{ path: 'startDate', message: 'startLocked' }]);
    }
    const next = {
      jobPositionId: input.positionId ?? assignment.jobPositionId,
      startDate: input.startDate ?? assignment.startDate,
      endDate: input.endDate === undefined ? assignment.endDate : input.endDate,
      note: input.note === undefined ? assignment.note : input.note,
    };
    if (next.endDate && next.endDate < next.startDate) {
      throw new ValidationError([{ path: 'endDate', message: 'endBeforeStart' }]);
    }
    if (input.positionId && input.positionId !== assignment.jobPositionId) {
      await this.ctx.lists.requireUsable(tenant.id, 'job_position', input.positionId);
    }
    await this.assertNoOverlap(project.id, member.id, next, assignment.id);
    const before = {
      jobPositionId: assignment.jobPositionId,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      note: assignment.note,
    };
    const changes = changedFields(before, next);
    if (!changes) return;
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(workforceAssignment)
          .set({ ...next, updatedAt: new Date(this.ctx.now()), updatedBy: principal.userId })
          .where(eq(workforceAssignment.id, assignment.id)),
        ...this.ctx.record(principal, member, {
          audit: 'workforce.assignment.updated',
          activity: 'workforce.assignment_changed',
          entityType: 'workforce_assignment',
          entityId: assignment.id,
          projectId: project.id,
          oldValue: before,
          newValue: next,
          changes,
          snapshot: { projectCode: project.code, projectName: project.name },
        }),
      )
      .commit();
  }

  /** FR-4: End (today by default, up to 30 days back, not before the start). */
  async end(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    assignmentId: string,
    endDate: string,
  ): Promise<void> {
    assertProjectWritable(project);
    const { assignment, member } = await this.required(tenant, project, assignmentId);
    const today = this.ctx.today(tenant);
    if (assignment.cancelledAt) throw new ValidationError([{ path: 'id', message: 'cancelled' }]);
    if (endDate > today || endDate < addIsoDays(today, -30) || endDate < assignment.startDate) {
      throw new ValidationError([{ path: 'endDate', message: 'endDateRange' }]);
    }
    await new UnitOfWork(this.ctx.db)
      .add(...this.endStatements(principal, member, assignment, project, endDate))
      .commit();
  }

  /** FR-4: Cancel, upcoming assignments only. */
  async cancel(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    assignmentId: string,
  ): Promise<void> {
    assertProjectWritable(project);
    const { assignment, member } = await this.required(tenant, project, assignmentId);
    if (assignmentState(assignment, this.ctx.today(tenant)) !== 'upcoming') {
      throw new ValidationError([{ path: 'id', message: 'notUpcoming' }]);
    }
    await new UnitOfWork(this.ctx.db)
      .add(...this.cancelStatements(principal, member, assignment, project))
      .commit();
  }

  /** FR-5: end current and cancel upcoming assignments (status Inactive or Terminated). */
  async closeAllStatements(
    tenant: TenantCompany,
    principal: Principal,
    member: WorkforceMemberRow,
  ): Promise<{ statements: Statement[]; ended: number; cancelled: number }> {
    const today = this.ctx.today(tenant);
    const open = await this.ctx.repo.openAssignments(member.id, today);
    const projects = await new ProjectDirectory(this.ctx.db).getMany(
      tenant.id,
      open.map((row) => row.projectId),
    );
    const statements: Statement[] = [];
    let ended = 0;
    let cancelled = 0;
    for (const row of open) {
      const project = projects.get(row.projectId);
      const facts = { id: row.projectId, code: project?.code ?? '', name: project?.name ?? '' };
      if (row.startDate > today) {
        statements.push(...this.cancelStatements(principal, member, row, facts));
        cancelled += 1;
      } else {
        statements.push(...this.endStatements(principal, member, row, facts, today));
        ended += 1;
      }
    }
    return { statements, ended, cancelled };
  }

  /** The person's assignments on every project (US-025 flow 5). */
  async ofMember(tenant: TenantCompany, memberId: string) {
    const today = this.ctx.today(tenant);
    const rows = await this.ctx.repo.assignmentsOfMembers([memberId]);
    const [projects, items] = await Promise.all([
      new ProjectDirectory(this.ctx.db).getMany(
        tenant.id,
        rows.map((row) => row.projectId),
      ),
      this.ctx.lists.byIds(
        tenant.id,
        rows.map((row) => row.jobPositionId),
      ),
    ]);
    return {
      items: rows.map((row) => assignmentDto(row, projects.get(row.projectId), items, today)),
    };
  }

  private endStatements(
    principal: Principal,
    member: WorkforceMemberRow,
    assignment: WorkforceAssignmentRow,
    project: { id: string; code: string; name: string },
    endDate: string,
  ): Statement[] {
    return [
      this.ctx.db
        .update(workforceAssignment)
        .set({
          endDate,
          endedBy: principal.userId,
          updatedAt: new Date(this.ctx.now()),
          updatedBy: principal.userId,
        })
        .where(eq(workforceAssignment.id, assignment.id)),
      ...this.ctx.record(principal, member, {
        audit: 'workforce.assignment.ended',
        activity: 'workforce.assignment_ended',
        entityType: 'workforce_assignment',
        entityId: assignment.id,
        projectId: project.id,
        oldValue: { endDate: assignment.endDate },
        newValue: { endDate },
        changes: { before: { endDate: assignment.endDate }, after: { endDate } },
        snapshot: { projectCode: project.code, projectName: project.name },
      }),
    ];
  }

  private cancelStatements(
    principal: Principal,
    member: WorkforceMemberRow,
    assignment: WorkforceAssignmentRow,
    project: { id: string; code: string; name: string },
  ): Statement[] {
    const now = new Date(this.ctx.now());
    return [
      this.ctx.db
        .update(workforceAssignment)
        .set({
          cancelledAt: now,
          cancelledBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(eq(workforceAssignment.id, assignment.id)),
      ...this.ctx.record(principal, member, {
        audit: 'workforce.assignment.cancelled',
        activity: 'workforce.assignment_cancelled',
        entityType: 'workforce_assignment',
        entityId: assignment.id,
        projectId: project.id,
        oldValue: { startDate: assignment.startDate, endDate: assignment.endDate },
        snapshot: { projectCode: project.code, projectName: project.name },
      }),
    ];
  }

  private async assertNoOverlap(
    projectId: string,
    memberId: string,
    range: { startDate: string; endDate: string | null },
    exceptId: string,
  ): Promise<void> {
    const rows = await this.ctx.repo.assignmentsOn(projectId, [memberId]);
    const clash = rows.find((row) => row.id !== exceptId && overlaps(row, range));
    if (clash) throw new AssignmentOverlapError(clash.startDate);
  }

  private async required(tenant: TenantCompany, project: ProjectRow, assignmentId: string) {
    const assignment = await this.ctx.repo.findAssignment(tenant.id, project.id, assignmentId);
    if (!assignment) throw new NotFoundError();
    const member = await this.ctx.repo.findMember(tenant.id, assignment.workforceMemberId);
    if (!member) throw new NotFoundError();
    return { assignment, member };
  }
}
