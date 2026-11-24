import type { ProjectPermissionCode } from '@hse/shared';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import type { AppEnv } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '../../core/errors/app-error';
import { createDatabase } from '../../database/client';
import { permissionResolverFor } from '../identity';
import { ProjectRepository } from './project.repository';
import type { ProjectRow } from './project.schema';

const uuid = z.uuid();
const loaded = new WeakMap<Request, ProjectRow>();

export function tenantCompany(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

/** The project the guard loaded for this request. Only valid behind `requireProjectPermission`. */
export function currentProject(c: Context<AppEnv>): ProjectRow {
  const row = loaded.get(c.req.raw);
  if (!row) throw new NotFoundError();
  return row;
}

/**
 * Route guard at project scope (PLT-16 FR-8, T-35). Must run after `authenticate()`.
 * The project must belong to the request's company. A project the user can't view answers
 * `404` (ids can't be probed); one they can view but not act on answers `403`.
 */
export const requireProjectPermission = (permission: ProjectPermissionCode, param = 'id') =>
  createMiddleware<AppEnv>(async (c, next) => {
    const principal = c.get('principal') as Principal | undefined;
    if (!principal) throw new UnauthenticatedError();
    const company = tenantCompany(c);
    const id = c.req.param(param);
    if (!id || !uuid.safeParse(id).success) throw new NotFoundError();

    const row = await new ProjectRepository(createDatabase(c.env.DB)).find(company.id, id);
    if (!row) throw new NotFoundError();
    const granted = await permissionResolverFor(c).projectPermissions(
      principal.userId,
      company.id,
      row.id,
    );
    if (!granted.has('projects.view')) throw new NotFoundError();
    if (!granted.has(permission)) {
      c.get('logger').info('permission denied', { permission, scope: 'project' });
      throw new ForbiddenError();
    }
    loaded.set(c.req.raw, row);
    await next();
  });
