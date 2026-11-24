import {
  addProjectRoleRequestSchema,
  changeCompanyRoleRequestSchema,
  type ProjectRoleAssignmentDto,
  resetRolePermissionsRequestSchema,
  updateProjectRoleRequestSchema,
  updateRolePermissionsRequestSchema,
  type UserDetailDto,
} from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { created, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import {
  type ProjectRoleView,
  requireCompanyPermission,
  RoleAssignmentService,
  RolePermissionService,
  type UserRolesView,
  validateIdentitySession,
} from '../identity';
import { ProjectDirectory, type ProjectFacts } from '../project';

const signedIn = authenticate(validateIdentitySession);
const idParam = z.object({ id: z.uuid() });
const assignmentParam = z.object({ id: z.uuid(), assignmentId: z.uuid() });
const roleParam = z.object({ roleCode: z.string().min(1).max(40) });

function deps(c: Context<AppEnv>) {
  return { db: createDatabase(c.env.DB), meta: requestMeta(c), clock: Date.now };
}

function tenantCompany(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

/** A project of this company, or 404 (T-35: identity never reads the project table). */
async function projectOf(c: Context<AppEnv>, projectId: string): Promise<ProjectFacts> {
  const facts = await new ProjectDirectory(createDatabase(c.env.DB)).get(
    tenantCompany(c).id,
    projectId,
  );
  if (!facts) throw new NotFoundError();
  return facts;
}

async function toDetail(c: Context<AppEnv>, view: UserRolesView): Promise<UserDetailDto> {
  const all = [...view.projectRoles, ...view.pastProjectRoles];
  const projects = await new ProjectDirectory(createDatabase(c.env.DB)).getMany(
    tenantCompany(c).id,
    all.map((role) => role.projectId),
  );
  const withProject = (role: ProjectRoleView): ProjectRoleAssignmentDto => {
    const project = projects.get(role.projectId);
    return {
      ...role,
      projectCode: project?.code ?? '',
      projectName: project?.name ?? '',
      projectStatus: project?.status ?? 'archived',
    };
  };
  return {
    id: view.user.id,
    fullName: view.user.fullName,
    email: view.user.email,
    phone: view.user.phone,
    status: view.user.status,
    lastLoginAt: view.user.lastLoginAt?.getTime() ?? null,
    companyRole: view.companyRole,
    projectRoles: view.projectRoles.map(withProject),
    pastProjectRoles: view.pastProjectRoles.map(withProject),
  };
}

async function detailFor(c: Context<AppEnv>, userId: string): Promise<UserDetailDto> {
  return toDetail(c, await new RoleAssignmentService(deps(c)).view(tenantCompany(c), userId));
}

/** `/api/v1/users/{id}…` — US-008 role assignment. Mounted next to the identity user routes. */
export const userAccessRoutes = new Hono<AppEnv>()
  .get(
    '/:id',
    signedIn,
    requireCompanyPermission('users.view'),
    validate('param', idParam),
    async (c) => ok(c, await detailFor(c, c.req.valid('param').id)),
  )
  .put(
    '/:id/company-role',
    signedIn,
    requireCompanyPermission('users.roles.assign'),
    validate('param', idParam),
    validate('json', changeCompanyRoleRequestSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      await new RoleAssignmentService(deps(c)).changeCompanyRole(
        tenantCompany(c),
        c.get('principal'),
        id,
        c.req.valid('json').roleCode,
      );
      return ok(c, await detailFor(c, id), { message: 'Role changed' });
    },
  )
  .post(
    '/:id/project-roles',
    signedIn,
    requireCompanyPermission('users.roles.assign'),
    validate('param', idParam),
    validate('json', addProjectRoleRequestSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const project = await projectOf(c, input.projectId);
      await new RoleAssignmentService(deps(c)).addProjectRole(
        tenantCompany(c),
        c.get('principal'),
        id,
        project,
        input,
      );
      return created(c, await detailFor(c, id), { message: 'Added to project' });
    },
  )
  .patch(
    '/:id/project-roles/:assignmentId',
    signedIn,
    requireCompanyPermission('users.roles.assign'),
    validate('param', assignmentParam),
    validate('json', updateProjectRoleRequestSchema),
    async (c) => {
      const { id, assignmentId } = c.req.valid('param');
      const service = new RoleAssignmentService(deps(c));
      const company = tenantCompany(c);
      const project = await projectOf(
        c,
        await service.assignmentProjectId(company, id, assignmentId),
      );
      await service.updateProjectRole(
        company,
        c.get('principal'),
        id,
        assignmentId,
        project,
        c.req.valid('json'),
      );
      return ok(c, await detailFor(c, id), { message: 'Project role saved' });
    },
  )
  .delete(
    '/:id/project-roles/:assignmentId',
    signedIn,
    requireCompanyPermission('users.roles.assign'),
    validate('param', assignmentParam),
    async (c) => {
      const { id, assignmentId } = c.req.valid('param');
      const service = new RoleAssignmentService(deps(c));
      const company = tenantCompany(c);
      const project = await projectOf(
        c,
        await service.assignmentProjectId(company, id, assignmentId),
      );
      await service.removeProjectRole(company, c.get('principal'), id, assignmentId, project);
      return c.body(null, 204);
    },
  );

/** `/api/v1/roles` — US-009 permission assignment. */
export const roleRoutes = new Hono<AppEnv>()
  .get('/', signedIn, requireCompanyPermission('roles.view'), async (c) =>
    ok(c, await new RolePermissionService(deps(c)).list(tenantCompany(c))),
  )
  .get(
    '/:roleCode',
    signedIn,
    requireCompanyPermission('roles.view'),
    validate('param', roleParam),
    async (c) =>
      ok(
        c,
        await new RolePermissionService(deps(c)).detail(
          tenantCompany(c),
          c.req.valid('param').roleCode,
        ),
      ),
  )
  .put(
    '/:roleCode/permissions',
    signedIn,
    requireCompanyPermission('roles.permissions.edit'),
    validate('param', roleParam),
    validate('json', updateRolePermissionsRequestSchema),
    async (c) => {
      const { version, granted } = c.req.valid('json');
      const role = await new RolePermissionService(deps(c)).update(
        tenantCompany(c),
        c.get('principal'),
        c.req.valid('param').roleCode,
        version,
        granted,
      );
      return ok(c, role, { message: 'Permissions saved' });
    },
  )
  .post(
    '/:roleCode/permissions/reset',
    signedIn,
    requireCompanyPermission('roles.permissions.edit'),
    validate('param', roleParam),
    validate('json', resetRolePermissionsRequestSchema),
    async (c) => {
      const role = await new RolePermissionService(deps(c)).reset(
        tenantCompany(c),
        c.get('principal'),
        c.req.valid('param').roleCode,
        c.req.valid('json').version,
      );
      return ok(c, role, { message: 'Permissions reset' });
    },
  );
