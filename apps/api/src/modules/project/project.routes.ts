import {
  buildPaginationMeta,
  changeProjectStatusRequestSchema,
  createProjectRequestSchema,
  projectListQuerySchema,
  projectVersionRequestSchema,
  updateProjectRequestSchema,
} from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import { requestMeta } from '../../core/http/request-meta';
import { created, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import {
  permissionResolverFor,
  requireCompanyPermission,
  validateIdentitySession,
} from '../identity';
import { currentProject, requireProjectPermission, tenantCompany } from './project-permission';
import { placeRoutes, switcherRoutes, timelineRoutes } from './project-structure.routes';
import { ProjectService } from './project.service';

const signedIn = authenticate(validateIdentitySession);

function serviceFor(c: Context<AppEnv>): ProjectService {
  return new ProjectService({
    db: createDatabase(c.env.DB),
    meta: requestMeta(c),
    clock: Date.now,
    resolver: permissionResolverFor(c),
  });
}

/** `/api/v1/projects` — US-016 – US-018. */
export const projectRoutes = new Hono<AppEnv>()
  // PLT-19: before `/:id`, which would otherwise take "switcher" as an id.
  .route('/', switcherRoutes)
  .route('/', placeRoutes)
  .route('/', timelineRoutes)
  // US-016 FR-4: filtered to the projects the caller may view.
  .get('/', signedIn, validate('query', projectListQuerySchema), async (c) => {
    const { search, status, page, pageSize } = c.req.valid('query');
    const result = await serviceFor(c).list(tenantCompany(c), c.get('principal'), {
      search,
      statuses: status,
      page,
      pageSize,
    });
    return ok(c, result.items, {
      meta: { ...buildPaginationMeta({ page, pageSize }, result.total) },
    });
  })

  .post(
    '/',
    signedIn,
    requireCompanyPermission('projects.create'),
    validate('json', createProjectRequestSchema),
    async (c) => {
      const service = serviceFor(c);
      const company = tenantCompany(c);
      const row = await service.create(company, c.get('principal'), c.req.valid('json'));
      return created(c, await service.toDto(company, c.get('principal'), row), {
        message: 'Project created',
      });
    },
  )

  .get('/:id', signedIn, requireProjectPermission('projects.view'), async (c) =>
    ok(c, await serviceFor(c).toDto(tenantCompany(c), c.get('principal'), currentProject(c))),
  )

  // US-017
  .patch(
    '/:id',
    signedIn,
    requireProjectPermission('projects.edit'),
    validate('json', updateProjectRequestSchema),
    async (c) => {
      const service = serviceFor(c);
      const company = tenantCompany(c);
      const row = await service.update(
        company,
        c.get('principal'),
        currentProject(c),
        c.req.valid('json'),
      );
      return ok(c, await service.toDto(company, c.get('principal'), row), {
        message: 'Project saved',
      });
    },
  )
  .post(
    '/:id/status',
    signedIn,
    requireProjectPermission('projects.status.change'),
    validate('json', changeProjectStatusRequestSchema),
    async (c) => {
      const service = serviceFor(c);
      const company = tenantCompany(c);
      const row = await service.changeStatus(
        company,
        c.get('principal'),
        currentProject(c),
        c.req.valid('json'),
      );
      return ok(c, await service.toDto(company, c.get('principal'), row), {
        message: 'Status changed',
      });
    },
  )

  // US-018
  .post(
    '/:id/archive',
    signedIn,
    requireProjectPermission('projects.archive'),
    validate('json', projectVersionRequestSchema),
    async (c) => {
      const service = serviceFor(c);
      const company = tenantCompany(c);
      const row = await service.archive(
        company,
        c.get('principal'),
        currentProject(c),
        c.req.valid('json').version,
      );
      return ok(c, await service.toDto(company, c.get('principal'), row), {
        message: 'Project archived',
      });
    },
  )
  .post(
    '/:id/restore',
    signedIn,
    requireProjectPermission('projects.archive'),
    validate('json', projectVersionRequestSchema),
    async (c) => {
      const service = serviceFor(c);
      const company = tenantCompany(c);
      const row = await service.restore(
        company,
        c.get('principal'),
        currentProject(c),
        c.req.valid('json').version,
      );
      return ok(c, await service.toDto(company, c.get('principal'), row), {
        message: 'Project restored',
      });
    },
  );
