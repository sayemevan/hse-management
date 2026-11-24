import {
  addIsoDays,
  type createWorkforceMemberRequestSchema,
  generateId,
  LEAVING_STATUSES,
  type updateWorkforceMemberRequestSchema,
  WORKFORCE_LIMITS,
  type WorkforceDuplicatesDto,
  type WorkforceMemberDto,
  type WorkforcePageDto,
  type workforceStatusRequestSchema,
  type WorkforceSummaryDto,
  workforceKey,
} from '@hse/shared';
import type { z } from 'zod';
import { eq } from 'drizzle-orm';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import { UnitOfWork } from '../../database/unit-of-work';
import { changedFields } from '../../platform/activity';
import type { OpenedFile } from '../../platform/file-storage';
import { ProjectAudience, WorkforceUserLinks } from '../identity';
import { ProjectDirectory } from '../project';
import { AssignmentService } from './assignment.service';
import { listItemRef } from './list.service';
import { mayRead, type WorkforceAccess } from './workforce-access';
import type { WorkforceContext } from './workforce-context';
import {
  ArchiveRefusedError,
  EmployeeIdTakenError,
  UserAlreadyLinkedError,
  WorkforceArchivedError,
  WorkforceLimitReachedError,
} from './workforce.errors';
import { searchKeyOf } from './workforce.repository';
import { workforceMember, type WorkforceMemberRow } from './workforce.schema';
import { memberDto, memberRows } from './workforce-views';

type CreateInput = z.output<typeof createWorkforceMemberRequestSchema>;
type UpdateInput = z.output<typeof updateWorkforceMemberRequestSchema>;
type StatusInput = z.output<typeof workforceStatusRequestSchema>;

export function assertNotArchived(row: WorkforceMemberRow): void {
  if (row.archivedAt) throw new WorkforceArchivedError();
}

/** US-024: profiles, status, archive, photo and the user link. */
export class MemberService {
  constructor(private readonly ctx: WorkforceContext) {}

  async required(tenant: TenantCompany, memberId: string): Promise<WorkforceMemberRow> {
    const row = await this.ctx.repo.findMember(tenant.id, memberId);
    if (!row) throw new NotFoundError();
    return row;
  }

  /** FR-1. */
  async list(
    tenant: TenantCompany,
    access: WorkforceAccess,
    query: {
      search?: string | undefined;
      status?: WorkforceMemberRow['status'] | undefined;
      category?: WorkforceMemberRow['category'] | undefined;
      position?: string | undefined;
      nationality?: string | undefined;
      project?: string | undefined;
      attention: boolean;
      archived: boolean;
      page: number;
    },
  ): Promise<WorkforcePageDto> {
    await this.ctx.lists.ensureSeeded(tenant.id);
    const { rows, total } = await this.ctx.repo.listMembers(
      tenant.id,
      {
        attention: query.attention,
        archived: query.archived,
        ...(query.search ? { search: query.search } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.position ? { positionId: query.position } : {}),
        ...(query.nationality ? { nationality: query.nationality } : {}),
        ...(query.project ? { projectId: query.project } : {}),
      },
      { today: this.ctx.today(tenant), personal: access.personal, contacts: access.contacts },
      query.page,
    );
    return {
      items: await memberRows(this.ctx, tenant, access, rows),
      page: query.page,
      total,
      pageSize: WORKFORCE_LIMITS.pageSize,
    };
  }

  /** PLT-20 FR-4. */
  summary(tenant: TenantCompany, access: WorkforceAccess): Promise<WorkforceSummaryDto> {
    return this.ctx.repo.summary(tenant.id, {
      today: this.ctx.today(tenant),
      personal: access.personal,
      contacts: access.contacts,
    });
  }

  async get(
    tenant: TenantCompany,
    access: WorkforceAccess,
    memberId: string,
  ): Promise<WorkforceMemberDto> {
    const row = await this.required(tenant, memberId);
    return memberDto(this.ctx, tenant, access, row);
  }

  /** O-80: same full name and nationality (the form asks before saving). */
  async duplicates(
    tenant: TenantCompany,
    input: { fullName: string; nationality: string },
  ): Promise<WorkforceDuplicatesDto> {
    const rows = await this.ctx.repo.sameNameAndNationality(
      tenant.id,
      input.fullName,
      input.nationality,
    );
    const items = await this.ctx.lists.byIds(
      tenant.id,
      rows.map((row) => row.jobPositionId),
    );
    return {
      duplicates: rows.map((row) => {
        const position = items.get(row.jobPositionId);
        return {
          id: row.id,
          fullName: row.fullName,
          position: position ? listItemRef(position) : null,
          employer: row.employer,
        };
      }),
    };
  }

  /** FR-2. */
  async create(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    input: CreateInput,
  ): Promise<WorkforceMemberDto> {
    const position = await this.ctx.lists.requireUsable(
      tenant.id,
      'job_position',
      input.jobPositionId,
    );
    if ((await this.ctx.repo.countMembers(tenant.id)) >= WORKFORCE_LIMITS.profilesMax) {
      throw new WorkforceLimitReachedError(WORKFORCE_LIMITS.profilesMax);
    }
    const employeeId = input.employeeId ?? null;
    const employeeIdKey = employeeId ? workforceKey(employeeId) : null;
    if (employeeIdKey) await this.assertEmployeeIdFree(tenant.id, employeeIdKey, null);

    const id = generateId();
    const now = new Date(this.ctx.now());
    const values = {
      category: input.category,
      fullName: input.fullName,
      altName: input.altName ?? null,
      employeeId,
      nationality: input.nationality,
      employer: input.employer,
      jobPositionId: position.id,
      department: input.department ?? null,
      mobile: input.mobile ?? null,
      email: input.email ?? null,
    };
    const row: WorkforceMemberRow = {
      id,
      companyId: tenant.id,
      ...values,
      employeeIdKey,
      photoFileId: null,
      status: 'active',
      statusSince: this.ctx.today(tenant),
      statusReason: null,
      searchKey: searchKeyOf(values),
      archivedAt: null,
      archivedBy: null,
      createdAt: now,
      createdBy: principal.userId,
      updatedAt: now,
      updatedBy: principal.userId,
    };
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db.insert(workforceMember).values(row),
        ...this.ctx.record(principal, row, {
          audit: 'workforce.member.created',
          activity: 'workforce.member.created',
          newValue: values,
        }),
      )
      .commit();
    return memberDto(this.ctx, tenant, access, row);
  }

  /** FR-3. */
  async update(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    memberId: string,
    input: UpdateInput,
  ): Promise<WorkforceMemberDto> {
    const current = await this.required(tenant, memberId);
    assertNotArchived(current);
    const before = {
      category: current.category,
      fullName: current.fullName,
      altName: current.altName,
      employeeId: current.employeeId,
      nationality: current.nationality,
      employer: current.employer,
      jobPositionId: current.jobPositionId,
      department: current.department,
      mobile: current.mobile,
      email: current.email,
    };
    const after = { ...before };
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      const value = input[key];
      if (value !== undefined) (after as Record<string, unknown>)[key] = value ?? null;
    }
    const changes = changedFields(before, after);
    if (!changes) return memberDto(this.ctx, tenant, access, current);
    if (after.jobPositionId !== current.jobPositionId) {
      await this.ctx.lists.requireUsable(
        tenant.id,
        'job_position',
        after.jobPositionId,
        current.jobPositionId,
      );
    }
    const employeeIdKey = after.employeeId ? workforceKey(after.employeeId) : null;
    if (employeeIdKey && employeeIdKey !== current.employeeIdKey) {
      await this.assertEmployeeIdFree(tenant.id, employeeIdKey, current.id);
    }
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(workforceMember)
          .set({
            ...after,
            employeeIdKey,
            searchKey: searchKeyOf(after),
            updatedAt: new Date(this.ctx.now()),
            updatedBy: principal.userId,
          })
          .where(eq(workforceMember.id, current.id)),
        ...this.ctx.record(
          principal,
          { ...current, fullName: after.fullName },
          {
            audit: 'workforce.member.updated',
            activity: 'workforce.member.updated',
            oldValue: before,
            newValue: after,
            changes,
          },
        ),
      )
      .commit();
    return this.get(tenant, access, current.id);
  }

  /** FR-5 and O-78. */
  async changeStatus(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    memberId: string,
    input: StatusInput,
  ): Promise<WorkforceMemberDto> {
    const current = await this.required(tenant, memberId);
    assertNotArchived(current);
    const today = this.ctx.today(tenant);
    if (input.since > today || input.since < addIsoDays(today, -365)) {
      throw new ValidationError([{ path: 'since', message: 'sinceRange' }]);
    }
    const work = new UnitOfWork(this.ctx.db);
    let closed = { ended: 0, cancelled: 0 };
    if (input.endAssignments && LEAVING_STATUSES.includes(input.status)) {
      const result = await new AssignmentService(this.ctx).closeAllStatements(
        tenant,
        principal,
        current,
      );
      work.add(...result.statements);
      closed = { ended: result.ended, cancelled: result.cancelled };
    }
    const before = {
      status: current.status,
      since: current.statusSince,
      reason: current.statusReason,
    };
    const after = { status: input.status, since: input.since, reason: input.reason ?? null };
    work.add(
      this.ctx.db
        .update(workforceMember)
        .set({
          status: input.status,
          statusSince: input.since,
          statusReason: input.reason ?? null,
          updatedAt: new Date(this.ctx.now()),
          updatedBy: principal.userId,
        })
        .where(eq(workforceMember.id, current.id)),
      ...this.ctx.record(principal, current, {
        audit: 'workforce.member.status_changed',
        activity: 'workforce.member.status_changed',
        oldValue: before,
        newValue: { ...after, ...closed },
        changes: changedFields(before, after),
        snapshot: { status: input.status },
      }),
    );
    // US-024 Notifications: managers of the person's current projects hear about a suspension.
    if (input.status === 'suspended' && current.status !== 'suspended') {
      const current_ = await this.ctx.repo.currentAssignments([current.id], today);
      const projects = await new ProjectDirectory(this.ctx.db).getMany(
        tenant.id,
        current_.map((row) => row.projectId),
      );
      const audience = new ProjectAudience(this.ctx.db, this.ctx.deps.clock);
      for (const project of projects.values()) {
        const recipients = await audience.projectPermissionHolders(
          tenant.id,
          project.id,
          'projects.workforce.manage',
          this.ctx.deps.resolver,
        );
        work.add(
          ...this.ctx.notifications.entries({
            type: 'workforce.member.suspended',
            companyId: tenant.id,
            projectId: project.id,
            entityType: 'workforce_member',
            entityId: current.id,
            actorUserId: principal.userId,
            params: {
              memberName: current.fullName,
              projectCode: project.code,
              projectName: project.name,
              since: input.since,
            },
            recipients,
          }),
        );
      }
    }
    await work.commit();
    return this.get(tenant, access, current.id);
  }

  /** FR-6 and O-79. */
  async archive(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    memberId: string,
  ): Promise<WorkforceMemberDto> {
    const current = await this.required(tenant, memberId);
    assertNotArchived(current);
    if (!LEAVING_STATUSES.includes(current.status)) throw new ArchiveRefusedError('status');
    const open = await this.ctx.repo.openAssignments(current.id, this.ctx.today(tenant));
    if (open.length > 0) throw new ArchiveRefusedError('assignments');
    const now = this.ctx.now();
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(workforceMember)
          .set({
            archivedAt: new Date(now),
            archivedBy: principal.userId,
            updatedAt: new Date(now),
            updatedBy: principal.userId,
          })
          .where(eq(workforceMember.id, current.id)),
        // T-53: archiving removes the user link.
        new WorkforceUserLinks(this.ctx.db).unlinkMember(current.id, principal.userId, now),
        ...this.ctx.record(principal, current, {
          audit: 'workforce.member.archived',
          activity: 'workforce.member.archived',
        }),
      )
      .commit();
    return this.get(tenant, access, current.id);
  }

  /** O-79: restored as Inactive. */
  async restore(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    memberId: string,
  ): Promise<WorkforceMemberDto> {
    const current = await this.required(tenant, memberId);
    if (!current.archivedAt) return this.get(tenant, access, current.id);
    const now = this.ctx.now();
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(workforceMember)
          .set({
            archivedAt: null,
            archivedBy: null,
            status: 'inactive',
            statusSince: this.ctx.today(tenant),
            updatedAt: new Date(now),
            updatedBy: principal.userId,
          })
          .where(eq(workforceMember.id, current.id)),
        ...this.ctx.record(principal, current, {
          audit: 'workforce.member.restored',
          activity: 'workforce.member.restored',
        }),
      )
      .commit();
    return this.get(tenant, access, current.id);
  }

  /** FR-4. */
  async setPhoto(
    tenant: TenantCompany,
    principal: Principal,
    memberId: string,
    upload: File,
  ): Promise<{ photoUrl: string }> {
    const current = await this.required(tenant, memberId);
    assertNotArchived(current);
    const stored = await this.ctx.files.store({
      companyId: tenant.id,
      category: 'workforce_photo',
      uploadedBy: principal.userId,
      file: upload,
      beforeWrite: this.ctx.storageCheck(tenant.id),
    });
    const work = new UnitOfWork(this.ctx.db).add(
      stored.statement,
      this.ctx.db
        .update(workforceMember)
        .set({
          photoFileId: stored.row.id,
          updatedAt: new Date(this.ctx.now()),
          updatedBy: principal.userId,
        })
        .where(eq(workforceMember.id, current.id)),
      ...this.ctx.record(principal, current, {
        audit: 'workforce.member.photo_changed',
        activity: 'workforce.member.photo_changed',
        oldValue: { photoFileId: current.photoFileId },
        newValue: { photoFileId: stored.row.id },
      }),
    );
    if (current.photoFileId) work.add(this.ctx.files.remove(current.photoFileId, principal.userId));
    await work.commit();
    return { photoUrl: `/api/v1/workforce/${current.id}/photo?v=${stored.row.id}` };
  }

  async removePhoto(tenant: TenantCompany, principal: Principal, memberId: string): Promise<void> {
    const current = await this.required(tenant, memberId);
    assertNotArchived(current);
    if (!current.photoFileId) return;
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.files.remove(current.photoFileId, principal.userId),
        this.ctx.db
          .update(workforceMember)
          .set({
            photoFileId: null,
            updatedAt: new Date(this.ctx.now()),
            updatedBy: principal.userId,
          })
          .where(eq(workforceMember.id, current.id)),
        ...this.ctx.record(principal, current, {
          audit: 'workforce.member.photo_removed',
          oldValue: { photoFileId: current.photoFileId },
        }),
      )
      .commit();
  }

  /**
   * FR-4: `workforce.view`, the linked user, or `projects.workforce.view` on a project where the
   * person is currently assigned.
   */
  async openPhoto(
    tenant: TenantCompany,
    access: WorkforceAccess,
    memberId: string,
  ): Promise<OpenedFile | null> {
    const row = await this.ctx.repo.findMember(tenant.id, memberId);
    if (!row?.photoFileId) return null;
    if (!mayRead(access, row.id, 'view')) {
      const projects = await this.ctx.deps.resolver.projectAccess(
        access.userId,
        tenant.id,
        'projects.workforce.view',
      );
      const current = await this.ctx.repo.currentAssignments([row.id], this.ctx.today(tenant));
      const seen =
        current.length > 0 &&
        (projects.allProjects ||
          current.some((assignment) => projects.projectIds.includes(assignment.projectId)));
      if (!seen) return null;
    }
    return this.ctx.files.open(row.photoFileId, tenant.id);
  }

  /** FR-7 (T-53). */
  async link(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    memberId: string,
    userId: string,
  ): Promise<WorkforceMemberDto> {
    const current = await this.required(tenant, memberId);
    assertNotArchived(current);
    const links = new WorkforceUserLinks(this.ctx.db);
    const target = await links.find(tenant.id, userId);
    if (!target) throw new NotFoundError();
    if (target.memberId === current.id) return this.get(tenant, access, current.id);
    if (target.memberId) throw new UserAlreadyLinkedError();
    const now = this.ctx.now();
    const existing = (await links.usersOf(tenant.id, [current.id])).get(current.id);
    await new UnitOfWork(this.ctx.db)
      .add(
        links.unlinkMember(current.id, principal.userId, now),
        links.link(target.id, current.id, principal.userId, now),
        ...this.ctx.record(principal, current, {
          audit: 'workforce.member.user_linked',
          activity: 'workforce.member.user_linked',
          oldValue: { userId: existing?.id ?? null },
          newValue: { userId: target.id },
        }),
      )
      .commit();
    return this.get(tenant, access, current.id);
  }

  async unlink(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    memberId: string,
  ): Promise<WorkforceMemberDto> {
    const current = await this.required(tenant, memberId);
    const links = new WorkforceUserLinks(this.ctx.db);
    const existing = (await links.usersOf(tenant.id, [current.id])).get(current.id);
    if (!existing) return this.get(tenant, access, current.id);
    await new UnitOfWork(this.ctx.db)
      .add(
        links.unlinkMember(current.id, principal.userId, this.ctx.now()),
        ...this.ctx.record(principal, current, {
          audit: 'workforce.member.user_unlinked',
          activity: 'workforce.member.user_unlinked',
          oldValue: { userId: existing.id },
        }),
      )
      .commit();
    return this.get(tenant, access, current.id);
  }

  private async assertEmployeeIdFree(
    companyId: string,
    key: string,
    exceptId: string | null,
  ): Promise<void> {
    const other = await this.ctx.repo.findByEmployeeId(companyId, key);
    if (other && other.id !== exceptId) throw new EmployeeIdTakenError(other.fullName);
  }
}
