import {
  type AddProjectRoleRequest,
  ErrorCode,
  isCompanyWideRole,
  type CompanyRole,
  generateId,
  isProjectRole,
  nextIsoDate,
  PROJECT_ROLES_REQUIRING_END_DATE,
  type ProjectRole,
  type ProjectRoleState,
  type UpdateProjectRoleRequest,
  zonedDayStart,
  zonedIsoDate,
} from '@hse/shared';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/app-error';
import type { Database } from '../../database/client';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { ActivityService } from '../../platform/activity';
import { AuditLogService } from '../../platform/audit-log';
import { NotificationService } from '../../platform/notification';
import type { RequestMeta } from '../../core/http/request-meta';
import { LastAdministratorError, RoleNotAllowedError } from './identity.errors';
import type { UserRoleRow, UserRow } from './identity.schema';
import { InvitationRepository } from './invitation.repository';
import { PermissionResolver } from './permission-matrix';
import { ProjectAudience } from './project-audience';
import { RoleRepository } from './role.repository';
import { UserRepository } from './user.repository';

/** What identity needs to know about a project (given by the caller, T-35). */
export interface ProjectRef {
  id: string;
  status: string;
  code: string;
  name: string;
}

/** Where a change was made, recorded with its audit entry (US-022 audit requirements). */
export interface AssignmentOptions {
  via?: 'project_members';
  batchId?: string;
}

/** US-022 FR-6: a bulk add refused as a whole, with each user's reason. */
export class BulkAddRefusedError extends AppError {
  constructor(refused: { userId: string; name: string; reason: string }[]) {
    super(ErrorCode.BULK_ADD_REFUSED, 422, "Some people can't be added. Nobody was added.", {
      // One issue per refused user: path = user id, message = reason.
      details: refused.map((entry) => ({ path: entry.userId, message: entry.reason })),
      params: { names: refused.map((entry) => entry.name).join(', '), count: refused.length },
    });
  }
}

export interface ProjectRoleView {
  id: string;
  projectId: string;
  roleCode: string;
  validFrom: string | null;
  validUntil: string | null;
  state: ProjectRoleState;
}

export interface UserRolesView {
  user: UserRow;
  companyRole: string | null;
  projectRoles: ProjectRoleView[];
  pastProjectRoles: ProjectRoleView[];
}

/** US-018 FR-2: no new project roles on an archived project. */
export class ProjectArchivedForRolesError extends AppError {
  constructor() {
    super(ErrorCode.PROJECT_ARCHIVED, 409, 'This project is archived and cannot be changed.');
  }
}

export interface RoleAssignmentDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
}

/** US-008: company roles and project roles of the users of one company. */
export class RoleAssignmentService {
  private readonly users: UserRepository;
  private readonly roles: RoleRepository;
  private readonly invitations: InvitationRepository;
  private readonly audit: AuditLogService;
  private readonly notifications: NotificationService;
  private readonly activity: ActivityService;
  private readonly audience: ProjectAudience;

  constructor(private readonly deps: RoleAssignmentDeps) {
    this.users = new UserRepository(deps.db);
    this.roles = new RoleRepository(deps.db);
    this.invitations = new InvitationRepository(deps.db);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.notifications = new NotificationService(deps.db, deps.clock);
    this.activity = new ActivityService(deps.db, deps.clock);
    this.audience = new ProjectAudience(deps.db, deps.clock);
  }

  /** The user's roles, or 404 for a user outside the company (FR-1). */
  async view(company: TenantCompany, userId: string): Promise<UserRolesView> {
    const account = await this.member(company, userId);
    const now = this.deps.clock();
    const rows = await this.roles.listAllForUser(account.id, company.id);
    const current = rows.filter((row) => !ended(row, now));
    const companyRole = current.find((row) => row.scopeLevel === 'company')?.roleCode ?? null;
    const project = rows
      .filter((row) => row.scopeLevel === 'project' && row.projectId)
      .map((row) => toView(row, company.timeZone, now))
      .sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''));
    return {
      user: account,
      companyRole,
      projectRoles: project.filter((role) => role.state !== 'ended'),
      pastProjectRoles: project.filter((role) => role.state === 'ended').reverse(),
    };
  }

  /** FR-2, FR-3. */
  async changeCompanyRole(
    company: TenantCompany,
    principal: Principal,
    userId: string,
    roleCode: CompanyRole,
  ): Promise<void> {
    const account = await this.member(company, userId);
    const now = this.deps.clock();
    const current = (await this.roles.listAllForUser(account.id, company.id)).filter(
      (row) => row.scopeLevel === 'company' && !ended(row, now),
    );
    if (current.length === 1 && current[0]?.roleCode === roleCode) return;

    const wasAdministrator = current.some((row) => row.roleCode === 'company_administrator');
    if (wasAdministrator && roleCode !== 'company_administrator' && account.status === 'active') {
      const others = await this.roles.countOtherActiveAdministrators(company.id, account.id, now);
      if (others === 0) throw new LastAdministratorError();
    }

    const statements: Statement[] = current.map((row) =>
      this.roles.end(row.id, now, principal.userId),
    );
    statements.push(
      this.roles.assign({
        id: generateId(),
        userId: account.id,
        roleCode,
        scopeLevel: 'company',
        companyId: company.id,
        projectId: null,
        validFrom: new Date(now),
        createdBy: principal.userId,
      }),
    );
    if (account.status === 'pending_invitation') {
      const invitation = await this.invitations.findOpenForUser(account.id);
      if (invitation) {
        statements.push(this.invitations.setRole(invitation.id, roleCode, principal.userId, now));
      }
    }
    await new UnitOfWork(this.deps.db)
      .add(
        ...statements,
        this.audit.entry({
          action: 'user.role.changed',
          actorUserId: principal.userId,
          companyId: company.id,
          entityType: 'user',
          entityId: account.id,
          oldValue: { roleCode: current[0]?.roleCode ?? null },
          newValue: { roleCode },
        }),
        ...this.notifications.entries({
          type: 'company.role.changed',
          companyId: company.id,
          entityType: 'user',
          entityId: account.id,
          actorUserId: principal.userId,
          params: { roleCode },
          recipients: account.status === 'active' ? [account.id] : [],
        }),
      )
      .commit();
  }

  /** FR-4. */
  async addProjectRole(
    company: TenantCompany,
    principal: Principal,
    userId: string,
    project: ProjectRef,
    input: AddProjectRoleRequest,
  ): Promise<string> {
    const account = await this.member(company, userId);
    if (project.status === 'archived') throw new ProjectArchivedForRolesError();
    if (!isProjectRole(input.roleCode)) throw new RoleNotAllowedError();
    const now = this.deps.clock();
    const dates = this.checkDates(
      company,
      input.roleCode,
      input.validFrom ?? null,
      input.validUntil ?? null,
      now,
    );
    if (await this.hasProjectRole(account.id, company.id, project.id, now)) {
      throw new ConflictError('This user already has a role on this project.');
    }
    const id = generateId();
    await new UnitOfWork(this.deps.db)
      .add(
        ...this.assignmentStatements(company, principal, account, project, input, dates, id, {}),
        ...(await this.joinedNotice(company, principal, project, [account], input.roleCode)),
      )
      .commit();
    return id;
  }

  /**
   * US-022 FR-3, FR-6: several users with the same role and dates, all or none. Users already
   * on the project or holding a company-wide role are refused with their reason.
   */
  async addProjectRoles(
    company: TenantCompany,
    principal: Principal,
    userIds: readonly string[],
    project: ProjectRef,
    input: Omit<AddProjectRoleRequest, 'projectId'>,
  ): Promise<string[]> {
    if (project.status === 'archived') throw new ProjectArchivedForRolesError();
    if (!isProjectRole(input.roleCode)) throw new RoleNotAllowedError();
    const now = this.deps.clock();
    const dates = this.checkDates(
      company,
      input.roleCode,
      input.validFrom ?? null,
      input.validUntil ?? null,
      now,
    );
    const accounts: UserRow[] = [];
    const refused: { userId: string; name: string; reason: string }[] = [];
    for (const userId of new Set(userIds)) {
      const account = await this.users.findById(userId);
      if (
        account?.companyId !== company.id ||
        account.deletedAt ||
        !['active', 'pending_invitation'].includes(account.status)
      ) {
        refused.push({ userId, name: account?.fullName ?? '', reason: 'notInCompany' });
        continue;
      }
      const rows = (await this.roles.listAllForUser(account.id, company.id)).filter(
        (row) => !ended(row, now),
      );
      if (rows.some((row) => row.scopeLevel === 'company' && isCompanyWideRole(row.roleCode))) {
        refused.push({ userId, name: account.fullName, reason: 'companyWide' });
      } else if (rows.some((row) => row.scopeLevel === 'project' && row.projectId === project.id)) {
        refused.push({ userId, name: account.fullName, reason: 'alreadyOnProject' });
      } else {
        accounts.push(account);
      }
    }
    if (refused.length > 0) throw new BulkAddRefusedError(refused);

    const batchId = accounts.length > 1 ? generateId() : undefined;
    const ids = accounts.map(() => generateId());
    const statements = accounts.flatMap((account, index) =>
      this.assignmentStatements(
        company,
        principal,
        account,
        project,
        input,
        dates,
        ids[index] ?? generateId(),
        { via: 'project_members', batchId },
      ),
    );
    await new UnitOfWork(this.deps.db)
      .add(
        ...statements,
        ...(await this.joinedNotice(company, principal, project, accounts, input.roleCode)),
      )
      .commit();
    return ids;
  }

  private async hasProjectRole(
    userId: string,
    companyId: string,
    projectId: string,
    now: number,
  ): Promise<boolean> {
    return (await this.roles.listAllForUser(userId, companyId)).some(
      (row) => row.scopeLevel === 'project' && row.projectId === projectId && !ended(row, now),
    );
  }

  /** The role row, its audit and timeline entries, and the member's own notification. */
  private assignmentStatements(
    company: TenantCompany,
    principal: Principal,
    account: UserRow,
    project: ProjectRef,
    input: { roleCode: ProjectRole; validFrom?: string | null; validUntil?: string | null },
    dates: { from: Date | null; until: Date | null },
    id: string,
    options: AssignmentOptions,
  ): Statement[] {
    const values = {
      roleCode: input.roleCode,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
    };
    return [
      this.roles.assign({
        id,
        userId: account.id,
        roleCode: input.roleCode,
        scopeLevel: 'project',
        companyId: company.id,
        projectId: project.id,
        validFrom: dates.from,
        validUntil: dates.until,
        createdBy: principal.userId,
      }),
      this.audit.entry({
        action: 'user.project_role.added',
        actorUserId: principal.userId,
        companyId: company.id,
        projectId: project.id,
        entityType: 'user',
        entityId: account.id,
        newValue: { ...values, ...viaOf(options) },
      }),
      this.activity.entry({
        action: 'member.added',
        companyId: company.id,
        projectId: project.id,
        entityType: 'user',
        entityId: account.id,
        actorUserId: principal.userId,
        changes: { before: {}, after: values },
        snapshot: snapshotOf(project, account, input.roleCode),
      }),
      ...this.notifications.entries({
        type: 'project.member.added',
        companyId: company.id,
        projectId: project.id,
        entityType: 'project',
        entityId: project.id,
        actorUserId: principal.userId,
        params: {
          projectCode: project.code,
          projectName: project.name,
          roleCode: input.roleCode,
          validUntil: input.validUntil ?? null,
        },
        recipients: account.status === 'active' ? [account.id] : [],
      }),
    ];
  }

  /** PLT-17 `project.member.joined`: one notification per new member to each manager. */
  private async joinedNotice(
    company: TenantCompany,
    principal: Principal,
    project: ProjectRef,
    accounts: readonly UserRow[],
    roleCode: string,
  ): Promise<Statement[]> {
    const managers = await this.audience.memberManagers(
      company.id,
      project.id,
      new PermissionResolver(this.deps.db, this.deps.clock),
    );
    const added = new Set(accounts.map((account) => account.id));
    const recipients = managers.filter((id) => !added.has(id));
    return accounts.flatMap((account) =>
      this.notifications.entries({
        type: 'project.member.joined',
        companyId: company.id,
        projectId: project.id,
        entityType: 'project',
        entityId: project.id,
        actorUserId: principal.userId,
        params: {
          projectCode: project.code,
          projectName: project.name,
          memberName: account.fullName,
          roleCode,
        },
        recipients,
      }),
    );
  }

  /** FR-5: ends the row and inserts a new one, keeping its start. */
  async updateProjectRole(
    company: TenantCompany,
    principal: Principal,
    userId: string,
    assignmentId: string,
    project: ProjectRef,
    input: UpdateProjectRoleRequest,
    options: AssignmentOptions = {},
  ): Promise<string> {
    const { row, account } = await this.assignment(company, userId, assignmentId);
    if (project.status === 'archived') throw new ProjectArchivedForRolesError();
    const now = this.deps.clock();
    const roleCode = input.roleCode ?? (row.roleCode as ProjectRole);
    if (!isProjectRole(roleCode)) throw new RoleNotAllowedError();
    const before = toView(row, company.timeZone, now);
    const untilDate = input.validUntil === undefined ? before.validUntil : input.validUntil;
    const dates = this.checkDates(company, roleCode, null, untilDate, now);

    const id = generateId();
    await new UnitOfWork(this.deps.db)
      .add(
        this.roles.end(row.id, now, principal.userId),
        this.roles.assign({
          id,
          userId: account.id,
          roleCode,
          scopeLevel: 'project',
          companyId: company.id,
          projectId: row.projectId,
          validFrom: row.validFrom ?? row.createdAt,
          validUntil: dates.until,
          createdBy: principal.userId,
        }),
        this.audit.entry({
          action: 'user.project_role.changed',
          actorUserId: principal.userId,
          companyId: company.id,
          projectId: row.projectId,
          entityType: 'user',
          entityId: account.id,
          oldValue: { roleCode: row.roleCode, validUntil: before.validUntil },
          newValue: { roleCode, validUntil: untilDate, ...viaOf(options) },
        }),
        this.activity.entry({
          action: 'member.changed',
          companyId: company.id,
          projectId: project.id,
          entityType: 'user',
          entityId: account.id,
          actorUserId: principal.userId,
          changes: {
            before: { roleCode: row.roleCode, validUntil: before.validUntil },
            after: { roleCode, validUntil: untilDate },
          },
          snapshot: snapshotOf(project, account, roleCode),
        }),
        ...this.notifications.entries({
          type: 'project.member.role_changed',
          companyId: company.id,
          projectId: project.id,
          entityType: 'project',
          entityId: project.id,
          actorUserId: principal.userId,
          params: {
            projectCode: project.code,
            projectName: project.name,
            roleCode,
            validUntil: untilDate,
          },
          recipients: account.status === 'active' ? [account.id] : [],
        }),
      )
      .commit();
    return id;
  }

  /** FR-6: ends the role now; the row is kept (T-34). */
  async removeProjectRole(
    company: TenantCompany,
    principal: Principal,
    userId: string,
    assignmentId: string,
    project: ProjectRef,
    options: AssignmentOptions = {},
  ): Promise<void> {
    const { row, account } = await this.assignment(company, userId, assignmentId);
    if (row.projectId !== project.id) throw new NotFoundError();
    const now = this.deps.clock();
    await new UnitOfWork(this.deps.db)
      .add(
        this.roles.end(row.id, now, principal.userId),
        this.audit.entry({
          action: 'user.project_role.removed',
          actorUserId: principal.userId,
          companyId: company.id,
          projectId: row.projectId,
          entityType: 'user',
          entityId: account.id,
          oldValue: { roleCode: row.roleCode },
          newValue: viaOf(options),
        }),
        this.activity.entry({
          action: 'member.removed',
          companyId: company.id,
          projectId: project.id,
          entityType: 'user',
          entityId: account.id,
          actorUserId: principal.userId,
          snapshot: snapshotOf(project, account, row.roleCode),
        }),
        ...this.notifications.entries({
          type: 'project.member.removed',
          companyId: company.id,
          projectId: project.id,
          entityType: 'project',
          entityId: project.id,
          actorUserId: principal.userId,
          params: { projectCode: project.code, projectName: project.name },
          recipients: account.status === 'active' ? [account.id] : [],
        }),
      )
      .commit();
  }

  /** A project-role assignment in force or scheduled on this project (US-022). */
  async projectAssignment(
    company: TenantCompany,
    projectId: string,
    assignmentId: string,
  ): Promise<{ id: string; userId: string; roleCode: string } | undefined> {
    const row = await this.roles.findById(assignmentId);
    if (
      row?.companyId !== company.id ||
      row.projectId !== projectId ||
      row.scopeLevel !== 'project' ||
      ended(row, this.deps.clock())
    ) {
      return undefined;
    }
    return { id: row.id, userId: row.userId, roleCode: row.roleCode };
  }

  /** The project of an assignment still in force, for the caller to check (T-35). */
  async assignmentProjectId(
    company: TenantCompany,
    userId: string,
    assignmentId: string,
  ): Promise<string> {
    const { row } = await this.assignment(company, userId, assignmentId);
    return row.projectId ?? '';
  }

  /** Project roles in force or scheduled, per user (users list "Projects" count). */
  projectRoleCounts(userIds: readonly string[]): Promise<Map<string, number>> {
    return this.roles.projectRoleCounts(userIds, this.deps.clock());
  }

  private async member(company: TenantCompany, userId: string): Promise<UserRow> {
    const account = await this.users.findById(userId);
    if (account?.companyId !== company.id || account.deletedAt || account.status === 'archived') {
      throw new NotFoundError();
    }
    return account;
  }

  private async assignment(company: TenantCompany, userId: string, assignmentId: string) {
    const account = await this.member(company, userId);
    const now = this.deps.clock();
    const row = (await this.roles.listAllForUser(account.id, company.id)).find(
      (candidate) => candidate.id === assignmentId,
    );
    if (row?.scopeLevel !== 'project' || !row.projectId || ended(row, now)) {
      throw new NotFoundError();
    }
    return { row, account };
  }

  /** Validation rules of US-008 for From and Until (O-48). */
  private checkDates(
    company: TenantCompany,
    roleCode: ProjectRole,
    from: string | null,
    until: string | null,
    now: number,
  ): { from: Date | null; until: Date | null } {
    const today = zonedIsoDate(now, company.timeZone);
    const issues: { path: string; message: string }[] = [];
    if (!until && PROJECT_ROLES_REQUIRING_END_DATE.includes(roleCode)) {
      issues.push({ path: 'validUntil', message: 'endDateRequired' });
    }
    if (until && until < today) issues.push({ path: 'validUntil', message: 'endInPast' });
    if (from && until && from > until) issues.push({ path: 'validFrom', message: 'startAfterEnd' });
    if (issues.length > 0) throw new ValidationError(issues);
    return {
      from: from ? new Date(zonedDayStart(from, company.timeZone)) : new Date(now),
      until: until ? new Date(zonedDayStart(nextIsoDate(until), company.timeZone)) : null,
    };
  }
}

function viaOf(options: AssignmentOptions): Record<string, string> {
  const result: Record<string, string> = {};
  if (options.via) result.via = options.via;
  if (options.batchId) result.batchId = options.batchId;
  return result;
}

function snapshotOf(project: ProjectRef, account: UserRow, roleCode: string) {
  return {
    projectCode: project.code,
    projectName: project.name,
    memberName: account.fullName,
    roleCode,
  };
}

function ended(row: UserRoleRow, now: number): boolean {
  return row.validUntil !== null && row.validUntil.getTime() <= now;
}

function toView(row: UserRoleRow, timeZone: string, now: number): ProjectRoleView {
  const from = row.validFrom?.getTime() ?? null;
  const until = row.validUntil?.getTime() ?? null;
  const state: ProjectRoleState =
    until !== null && until <= now ? 'ended' : from !== null && from > now ? 'scheduled' : 'active';
  return {
    id: row.id,
    projectId: row.projectId ?? '',
    roleCode: row.roleCode,
    validFrom: from === null ? null : zonedIsoDate(from, timeZone),
    // Until is stored as the start of the next day; show the last day of access.
    validUntil: until === null ? null : zonedIsoDate(until - 1, timeZone),
    state,
  };
}
