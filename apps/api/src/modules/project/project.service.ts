import {
  acceptsRecords,
  type ChangeProjectStatusRequest,
  type CreateProjectRequest,
  generateId,
  nextProjectStatuses,
  type ProjectDto,
  type ProjectListItemDto,
  type ProjectStatus,
  type UpdateProjectRequest,
} from '@hse/shared';

import type { TenantCompany } from '../../core/context/tenant';
import type { Principal } from '../../core/auth/principal';
import { ValidationError } from '../../core/errors/app-error';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { ActivityService, changedFields } from '../../platform/activity';
import { AuditLogService } from '../../platform/audit-log';
import { NotificationService } from '../../platform/notification';
import { type PermissionResolver, ProjectAudience, userNames } from '../identity';
import { PlanLimitService, SubscriptionService } from '../subscription';
import {
  InvalidStatusTransitionError,
  ProjectArchivedError,
  ProjectChangedError,
  ProjectCodeLockedError,
  ProjectCodeTakenError,
} from './project.errors';
import { PlaceDirectory } from './place-directory';
import { type ProjectChanges, ProjectRepository } from './project.repository';
import type { ProjectRow } from './project.schema';

export interface ProjectServiceDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
  resolver: PermissionResolver;
}

export type CreateProjectInput = Omit<CreateProjectRequest, 'status'> & {
  status: ProjectStatus;
  code: string;
};

/** US-016 – US-018: projects of one company. */
export class ProjectService {
  private readonly projects: ProjectRepository;
  private readonly audit: AuditLogService;
  private readonly activity: ActivityService;
  private readonly notifications: NotificationService;

  constructor(private readonly deps: ProjectServiceDeps) {
    this.projects = new ProjectRepository(deps.db);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.activity = new ActivityService(deps.db, deps.clock);
    this.notifications = new NotificationService(deps.db, deps.clock);
  }

  /** PLT-17: project notices go to the project's members (O-64). */
  private async memberNotice(
    companyId: string,
    current: ProjectRow,
    principal: Principal,
    type: 'project.status.changed' | 'project.archived' | 'project.restored',
    status: ProjectStatus,
  ): Promise<Statement[]> {
    const recipients = await new ProjectAudience(this.deps.db, this.deps.clock).members(
      companyId,
      current.id,
    );
    return this.notifications.entries({
      type,
      companyId,
      projectId: current.id,
      entityType: 'project',
      entityId: current.id,
      actorUserId: principal.userId,
      params: { projectCode: current.code, projectName: current.name, status },
      recipients,
    });
  }

  private limits(): PlanLimitService {
    return new PlanLimitService(new SubscriptionService(this.deps.db, this.deps.clock));
  }

  /** US-016 FR-4, FR-5: the projects the user may view. */
  async list(
    company: TenantCompany,
    principal: Principal,
    query: { search?: string; statuses: ProjectStatus[]; page: number; pageSize: number },
  ): Promise<{ items: ProjectListItemDto[]; total: number }> {
    const access = await this.deps.resolver.projectAccess(
      principal.userId,
      company.id,
      'projects.view',
    );
    const { rows, total } = await this.projects.list(company.id, {
      projectIds: access.allProjects ? null : access.projectIds,
      search: query.search,
      statuses: query.statuses,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items: rows.map(toListItem), total };
  }

  /** US-016 FR-1 – FR-3. */
  async create(
    company: TenantCompany,
    principal: Principal,
    input: CreateProjectInput,
  ): Promise<ProjectRow> {
    await this.limits().assertCanAdd(
      company.id,
      'projects',
      await this.projects.countNotArchived(company.id),
    );
    if (await this.projects.codeTaken(company.id, input.code)) throw new ProjectCodeTakenError();

    const id = generateId();
    const now = this.deps.clock();
    const values = {
      code: input.code,
      name: input.name,
      clientName: input.clientName,
      contractNumber: input.contractNumber ?? null,
      description: input.description ?? null,
      city: input.city ?? null,
      countryCode: input.countryCode,
      startDate: input.startDate,
      expectedEndDate: input.expectedEndDate ?? null,
      status: input.status,
    };
    try {
      await new UnitOfWork(this.deps.db)
        .add(
          this.projects.insert({
            id,
            companyId: company.id,
            ...values,
            statusChangedAt: new Date(now),
            createdBy: principal.userId,
            now,
          }),
          this.audit.entry({
            action: 'project.created',
            actorUserId: principal.userId,
            companyId: company.id,
            projectId: id,
            entityType: 'project',
            entityId: id,
            newValue: values,
          }),
          this.activity.entry({
            action: 'project.created',
            companyId: company.id,
            projectId: id,
            entityType: 'project',
            entityId: id,
            actorUserId: principal.userId,
            snapshot: { projectCode: input.code, projectName: input.name },
          }),
        )
        .commit();
    } catch (error) {
      if (await this.projects.codeTaken(company.id, input.code)) throw new ProjectCodeTakenError();
      throw error;
    }
    return this.required(company.id, id);
  }

  /** US-017 FR-1, FR-4, FR-5. */
  async update(
    company: TenantCompany,
    principal: Principal,
    current: ProjectRow,
    input: UpdateProjectRequest & { code?: string },
  ): Promise<ProjectRow> {
    if (current.status === 'archived') throw new ProjectArchivedError();
    if (current.updatedAt.getTime() !== input.version) throw new ProjectChangedError();

    const { version, ...fields } = input;
    const changes: ProjectChanges = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields) as [keyof ProjectChanges, unknown][]) {
      if (value === undefined) continue;
      const normalised = value ?? null;
      if (current[key] === normalised) continue;
      Object.assign(changes, { [key]: normalised });
      before[key] = current[key];
      after[key] = normalised;
    }
    if (changes.code !== undefined) {
      if (current.status !== 'planning') throw new ProjectCodeLockedError();
      if (await this.projects.codeTaken(company.id, changes.code, current.id)) {
        throw new ProjectCodeTakenError();
      }
    }
    const start = changes.startDate ?? current.startDate;
    const end =
      changes.expectedEndDate === undefined ? current.expectedEndDate : changes.expectedEndDate;
    if (end !== null && end < start) {
      throw new ValidationError([{ path: 'expectedEndDate', message: 'endBeforeStart' }]);
    }
    if (Object.keys(changes).length === 0) return current;

    await this.commitChange(current, version, changes, principal, {
      action: 'project.updated',
      before,
      after,
    });
    return this.required(company.id, current.id);
  }

  /** US-017 FR-2, FR-3. */
  async changeStatus(
    company: TenantCompany,
    principal: Principal,
    current: ProjectRow,
    input: ChangeProjectStatusRequest,
  ): Promise<ProjectRow> {
    if (current.status === 'archived') throw new ProjectArchivedError();
    if (current.updatedAt.getTime() !== input.version) throw new ProjectChangedError();
    const allowed = nextProjectStatuses(current.status, current.statusBeforeHold);
    if (!allowed.includes(input.status)) {
      throw new InvalidStatusTransitionError(current.status, input.status);
    }
    const now = this.deps.clock();
    const changes: ProjectChanges = {
      status: input.status,
      statusChangedAt: new Date(now),
      statusBeforeHold: input.status === 'on_hold' ? current.status : null,
    };
    // PLT-17 § Events: Active, On Hold and Completed are announced to the members.
    const notice = (['active', 'on_hold', 'completed'] as ProjectStatus[]).includes(input.status)
      ? await this.memberNotice(
          company.id,
          current,
          principal,
          'project.status.changed',
          input.status,
        )
      : [];
    await this.commitChange(
      current,
      input.version,
      changes,
      principal,
      {
        action: 'project.status.changed',
        before: { status: current.status },
        after: { status: input.status, note: input.note ?? null },
      },
      notice,
    );
    return this.required(company.id, current.id);
  }

  /** US-018 FR-1. */
  async archive(
    company: TenantCompany,
    principal: Principal,
    current: ProjectRow,
    version: number,
  ): Promise<ProjectRow> {
    if (current.status === 'archived') {
      throw new InvalidStatusTransitionError(current.status, 'archived');
    }
    if (current.updatedAt.getTime() !== version) throw new ProjectChangedError();
    const now = this.deps.clock();
    const notice = await this.memberNotice(
      company.id,
      current,
      principal,
      'project.archived',
      'archived',
    );
    await this.commitChange(
      current,
      version,
      {
        status: 'archived',
        statusBeforeArchive: current.status,
        statusChangedAt: new Date(now),
        archivedAt: new Date(now),
        archivedBy: principal.userId,
      },
      principal,
      {
        action: 'project.archived',
        before: { status: current.status },
        after: { status: 'archived' },
      },
      notice,
    );
    return this.required(company.id, current.id);
  }

  /** US-018 FR-4. */
  async restore(
    company: TenantCompany,
    principal: Principal,
    current: ProjectRow,
    version: number,
  ): Promise<ProjectRow> {
    if (current.status !== 'archived') {
      throw new InvalidStatusTransitionError(current.status, 'restored');
    }
    if (current.updatedAt.getTime() !== version) throw new ProjectChangedError();
    await this.limits().assertCanAdd(
      company.id,
      'projects',
      await this.projects.countNotArchived(company.id),
    );
    const status = current.statusBeforeArchive ?? 'planning';
    const notice = await this.memberNotice(
      company.id,
      current,
      principal,
      'project.restored',
      status,
    );
    await this.commitChange(
      current,
      version,
      {
        status,
        statusBeforeArchive: null,
        statusChangedAt: new Date(this.deps.clock()),
        archivedAt: null,
        archivedBy: null,
      },
      principal,
      { action: 'project.restored', before: { status: 'archived' }, after: { status } },
      notice,
    );
    return this.required(company.id, current.id);
  }

  /** The detail DTO with the caller's permissions (US-016 FR-6, T-37). */
  async toDto(company: TenantCompany, principal: Principal, row: ProjectRow): Promise<ProjectDto> {
    const [permissions, names, places, members] = await Promise.all([
      this.deps.resolver.projectPermissions(principal.userId, company.id, row.id),
      userNames(this.deps.db, row.archivedBy ? [row.archivedBy] : []),
      new PlaceDirectory(this.deps.db).activeCounts(row.id),
      new ProjectAudience(this.deps.db, this.deps.clock).memberCount(company.id, row.id),
    ]);
    const myPermissions = [...permissions].sort();
    return {
      ...toListItem(row),
      contractNumber: row.contractNumber,
      description: row.description,
      city: row.city,
      countryCode: row.countryCode,
      statusBeforeHold: row.statusBeforeHold,
      statusBeforeArchive: row.statusBeforeArchive,
      statusChangedAt: row.statusChangedAt.getTime(),
      archivedAt: row.archivedAt?.getTime() ?? null,
      archivedByName: row.archivedBy ? (names.get(row.archivedBy) ?? null) : null,
      createdAt: row.createdAt.getTime(),
      version: row.updatedAt.getTime(),
      acceptsRecords: acceptsRecords(row.status),
      codeEditable: row.status === 'planning' && myPermissions.includes('projects.edit'),
      allowedNextStatuses: myPermissions.includes('projects.status.change')
        ? nextProjectStatuses(row.status, row.statusBeforeHold)
        : [],
      myPermissions,
      counts: {
        areas: places.area,
        locations: places.location,
        workZones: places.work_zone,
        members,
      },
    };
  }

  private async commitChange(
    current: ProjectRow,
    version: number,
    changes: ProjectChanges,
    principal: Principal,
    audit: {
      action:
        'project.updated' | 'project.status.changed' | 'project.archived' | 'project.restored';
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    },
    extra: Statement[] = [],
  ): Promise<void> {
    const { companyId, id } = current;
    const now = this.deps.clock();
    try {
      await new UnitOfWork(this.deps.db)
        .add(
          this.projects.guardVersion(companyId, id, version),
          this.projects.update(companyId, id, version, changes, principal.userId, now),
          this.audit.entry({
            action: audit.action,
            actorUserId: principal.userId,
            companyId,
            projectId: id,
            entityType: 'project',
            entityId: id,
            oldValue: audit.before,
            newValue: audit.after,
          }),
          this.activity.entry({
            action: audit.action,
            companyId,
            projectId: id,
            entityType: 'project',
            entityId: id,
            actorUserId: principal.userId,
            changes: changedFields(audit.before, audit.after) ?? {
              before: audit.before,
              after: audit.after,
            },
            snapshot: {
              projectCode: changes.code ?? current.code,
              projectName: changes.name ?? current.name,
            },
          }),
          ...extra,
        )
        .commit();
    } catch (error) {
      const fresh = await this.projects.find(companyId, id);
      if (fresh && fresh.updatedAt.getTime() !== version) throw new ProjectChangedError();
      if (changes.code && (await this.projects.codeTaken(companyId, changes.code, id))) {
        throw new ProjectCodeTakenError();
      }
      throw error;
    }
  }

  private async required(companyId: string, id: string): Promise<ProjectRow> {
    const row = await this.projects.find(companyId, id);
    if (!row) throw new Error(`project ${id} vanished`);
    return row;
  }
}

export function toListItem(row: ProjectRow): ProjectListItemDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    clientName: row.clientName,
    status: row.status,
    startDate: row.startDate,
    expectedEndDate: row.expectedEndDate,
  };
}
