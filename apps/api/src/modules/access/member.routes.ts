import {
  addMembersRequestSchema,
  ErrorCode,
  type MemberCandidatesDto,
  memberCandidatesQuerySchema,
  memberListQuerySchema,
  type MemberUserDto,
  permissionDefinition,
  PROJECT_ROLES,
  type ProjectMemberDto,
  type ProjectMembersDto,
  updateMemberRequestSchema,
} from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import { AppError, NotFoundError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { created, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import {
  type MemberRow,
  permissionResolverFor,
  ProjectMembership,
  type RoleCode,
  RoleAssignmentService,
  type UserSummary,
  validateIdentitySession,
} from '../identity';
import { currentProject, requireProjectPermission } from '../project';

const signedIn = authenticate(validateIdentitySession);
const assignmentParam = z.object({ id: z.uuid(), assignmentId: z.uuid() });

/** T-46 / O-46: a role with more access than the caller holds on this project. */
export class RoleExceedsYourAccessError extends AppError {
  constructor() {
    super(
      ErrorCode.ROLE_EXCEEDS_YOUR_ACCESS,
      422,
      "You can't give a role with more access than you have.",
    );
  }
}

/** O-67: members manage other people's roles, not their own. */
export class CannotChangeOwnRoleError extends AppError {
  constructor() {
    super(ErrorCode.CANNOT_CHANGE_OWN_ROLE, 422, "You can't change your own role here.");
  }
}

export class MemberProjectArchivedError extends AppError {
  constructor() {
    super(ErrorCode.PROJECT_ARCHIVED, 409, 'This project is archived and cannot be changed.');
  }
}

function deps(c: Context<AppEnv>) {
  return { db: createDatabase(c.env.DB), meta: requestMeta(c), clock: Date.now };
}

function companyOf(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

/**
 * "No more than you hold" (T-46, US-022 FR-4). Holders of `users.roles.assign` are not limited;
 * everyone else may only handle roles whose project-scope permissions they all hold here.
 */
async function accessRules(c: Context<AppEnv>) {
  const resolver = permissionResolverFor(c);
  const company = companyOf(c);
  const project = currentProject(c);
  const userId = c.get('principal').userId;
  const [companyPermissions, mine] = await Promise.all([
    resolver.companyPermissions(userId, company.id),
    resolver.projectPermissions(userId, company.id, project.id),
  ]);
  const unrestricted = companyPermissions.has('users.roles.assign');
  const within = async (roleCode: string): Promise<boolean> => {
    if (unrestricted) return true;
    const grants = await resolver.roleGrants(company.id, roleCode as RoleCode);
    return [...grants]
      .filter((code) => permissionDefinition(code)?.scope === 'project')
      .every((code) => mine.has(code));
  };
  return {
    unrestricted,
    canManage: mine.has('projects.members.manage') && project.status !== 'archived',
    seesContacts: companyPermissions.has('users.view'),
    within,
    async assignableRoles(): Promise<string[]> {
      const result: string[] = [];
      for (const role of PROJECT_ROLES) if (await within(role)) result.push(role);
      return result;
    },
  };
}

function toUser(summary: UserSummary, contacts: boolean): MemberUserDto {
  return {
    id: summary.id,
    fullName: summary.fullName,
    email: contacts ? summary.email : null,
    phone: contacts ? summary.phone : null,
    status: summary.status,
  };
}

async function loadAssignment(c: Context<AppEnv>, assignmentId: string) {
  const project = currentProject(c);
  if (project.status === 'archived') throw new MemberProjectArchivedError();
  const service = new RoleAssignmentService(deps(c));
  const assignment = await service.projectAssignment(companyOf(c), project.id, assignmentId);
  if (!assignment) throw new NotFoundError();
  const rules = await accessRules(c);
  if (assignment.userId === c.get('principal').userId) throw new CannotChangeOwnRoleError();
  if (!(await rules.within(assignment.roleCode))) throw new RoleExceedsYourAccessError();
  return { service, project, assignment, rules };
}

/** `/api/v1/projects/{id}/members` — US-022. Mounted next to the project routes. */
export const projectMemberRoutes = new Hono<AppEnv>()
  .get(
    '/:id/members',
    signedIn,
    requireProjectPermission('projects.members.view'),
    validate('query', memberListQuerySchema),
    async (c) => {
      const { search, role, include } = c.req.valid('query');
      const company = companyOf(c);
      const rules = await accessRules(c);
      const view = await new ProjectMembership(createDatabase(c.env.DB)).view(
        company.id,
        currentProject(c).id,
        company.timeZone,
      );
      const me = c.get('principal').userId;
      const needle = search?.toLocaleLowerCase();
      const matches = (summary: UserSummary, roleCode: string) =>
        (!role || roleCode === role) &&
        (!needle ||
          summary.fullName.toLocaleLowerCase().includes(needle) ||
          summary.email.toLowerCase().includes(needle));
      const toDto = async (row: MemberRow): Promise<ProjectMemberDto> => ({
        assignmentId: row.assignmentId,
        user: toUser(row.user, rules.seesContacts),
        roleCode: row.roleCode,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        state: row.state,
        manageable:
          rules.canManage &&
          row.state !== 'ended' &&
          row.user.id !== me &&
          (await rules.within(row.roleCode)),
      });
      const team = await Promise.all(
        view.team.filter((row) => matches(row.user, row.roleCode)).map(toDto),
      );
      const past =
        include === 'past'
          ? await Promise.all(view.past.filter((row) => matches(row.user, row.roleCode)).map(toDto))
          : [];
      const body: ProjectMembersDto = {
        team,
        past,
        companyWide: view.companyWide
          .filter((row) => !role && matches(row.user, row.companyRoleCode))
          .map((row) => ({
            user: toUser(row.user, rules.seesContacts),
            companyRoleCode: row.companyRoleCode,
          })),
      };
      return ok(c, body);
    },
  )

  .get(
    '/:id/members/candidates',
    signedIn,
    requireProjectPermission('projects.members.manage'),
    validate('query', memberCandidatesQuerySchema),
    async (c) => {
      const rules = await accessRules(c);
      const items = await new ProjectMembership(createDatabase(c.env.DB)).candidates(
        companyOf(c).id,
        currentProject(c).id,
        c.req.valid('query').search,
      );
      const body: MemberCandidatesDto = { items, assignableRoles: await rules.assignableRoles() };
      return ok(c, body);
    },
  )

  .post(
    '/:id/members',
    signedIn,
    requireProjectPermission('projects.members.manage'),
    validate('json', addMembersRequestSchema),
    async (c) => {
      const input = c.req.valid('json');
      const project = currentProject(c);
      if (project.status === 'archived') throw new MemberProjectArchivedError();
      const rules = await accessRules(c);
      if (!(await rules.within(input.roleCode))) throw new RoleExceedsYourAccessError();
      const ids = await new RoleAssignmentService(deps(c)).addProjectRoles(
        companyOf(c),
        c.get('principal'),
        input.userIds,
        project,
        input,
      );
      return created(c, { added: ids }, { message: 'Members added' });
    },
  )

  .patch(
    '/:id/members/:assignmentId',
    signedIn,
    requireProjectPermission('projects.members.manage'),
    validate('param', assignmentParam),
    validate('json', updateMemberRequestSchema),
    async (c) => {
      const input = c.req.valid('json');
      const { service, project, assignment, rules } = await loadAssignment(
        c,
        c.req.valid('param').assignmentId,
      );
      if (input.roleCode && !(await rules.within(input.roleCode))) {
        throw new RoleExceedsYourAccessError();
      }
      const id = await service.updateProjectRole(
        companyOf(c),
        c.get('principal'),
        assignment.userId,
        assignment.id,
        project,
        input,
        { via: 'project_members' },
      );
      return ok(c, { assignmentId: id }, { message: 'Member saved' });
    },
  )

  .delete(
    '/:id/members/:assignmentId',
    signedIn,
    requireProjectPermission('projects.members.manage'),
    validate('param', assignmentParam),
    async (c) => {
      const { service, project, assignment } = await loadAssignment(
        c,
        c.req.valid('param').assignmentId,
      );
      await service.removeProjectRole(
        companyOf(c),
        c.get('principal'),
        assignment.userId,
        assignment.id,
        project,
        { via: 'project_members' },
      );
      return c.body(null, 204);
    },
  );
