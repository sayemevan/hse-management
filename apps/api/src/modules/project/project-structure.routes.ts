import {
  ACTIVITY_ACTIONS,
  type ActivityEntryDto,
  type ActivityGroup,
  createPlaceRequestSchema,
  lastProjectRequestSchema,
  movePlaceRequestSchema,
  placeTreeQuerySchema,
  type ProjectSwitcherDto,
  switcherQuerySchema,
  timelineQuerySchema,
  type TimelinePageDto,
  updatePlaceRequestSchema,
} from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import { NotFoundError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { created, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import { ActivityService, parseActivityCursor } from '../../platform/activity';
import {
  permissionResolverFor,
  UserPreferences,
  userSummaries,
  validateIdentitySession,
} from '../identity';
import { PlaceService } from './place.service';
import { currentProject, requireProjectPermission, tenantCompany } from './project-permission';
import { ProjectRepository } from './project.repository';

const signedIn = authenticate(validateIdentitySession);
const placeParam = z.object({ id: z.uuid(), placeId: z.uuid() });

function places(c: Context<AppEnv>): PlaceService {
  return new PlaceService({ db: createDatabase(c.env.DB), meta: requestMeta(c), clock: Date.now });
}

/** `/api/v1/projects/{id}/places` — US-019 – US-021. */
export const placeRoutes = new Hono<AppEnv>()
  .get(
    '/:id/places',
    signedIn,
    requireProjectPermission('projects.view'),
    validate('query', placeTreeQuerySchema),
    async (c) =>
      ok(c, await places(c).tree(currentProject(c), c.req.valid('query').includeInactive)),
  )
  .post(
    '/:id/places',
    signedIn,
    requireProjectPermission('projects.structure.manage'),
    validate('json', createPlaceRequestSchema),
    async (c) =>
      created(
        c,
        await places(c).create(currentProject(c), c.get('principal'), c.req.valid('json')),
        { message: 'Place added' },
      ),
  )
  .patch(
    '/:id/places/:placeId',
    signedIn,
    requireProjectPermission('projects.structure.manage'),
    validate('param', placeParam),
    validate('json', updatePlaceRequestSchema),
    async (c) =>
      ok(
        c,
        await places(c).update(
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').placeId,
          c.req.valid('json'),
        ),
        { message: 'Place saved' },
      ),
  )
  .post(
    '/:id/places/:placeId/move',
    signedIn,
    requireProjectPermission('projects.structure.manage'),
    validate('param', placeParam),
    validate('json', movePlaceRequestSchema),
    async (c) => {
      await places(c).move(
        currentProject(c),
        c.get('principal'),
        c.req.valid('param').placeId,
        c.req.valid('json').direction,
      );
      return c.body(null, 204);
    },
  )
  .post(
    '/:id/places/:placeId/deactivate',
    signedIn,
    requireProjectPermission('projects.structure.manage'),
    validate('param', placeParam),
    async (c) => {
      const count = await places(c).deactivate(
        currentProject(c),
        c.get('principal'),
        c.req.valid('param').placeId,
      );
      return ok(c, { deactivated: count }, { message: 'Place deactivated' });
    },
  )
  .post(
    '/:id/places/:placeId/reactivate',
    signedIn,
    requireProjectPermission('projects.structure.manage'),
    validate('param', placeParam),
    async (c) => {
      await places(c).reactivate(
        currentProject(c),
        c.get('principal'),
        c.req.valid('param').placeId,
      );
      return c.body(null, 204);
    },
  )
  .delete(
    '/:id/places/:placeId',
    signedIn,
    requireProjectPermission('projects.structure.manage'),
    validate('param', placeParam),
    async (c) => {
      await places(c).delete(currentProject(c), c.get('principal'), c.req.valid('param').placeId);
      return c.body(null, 204);
    },
  );

/** The timeline actions a reader may see, per group (PLT-18 FR-7). */
function visibleActions(group: ActivityGroup | undefined, permissions: Set<string>): string[] {
  return Object.entries(ACTIVITY_ACTIONS)
    .filter(([, actionGroup]) => !group || actionGroup === group)
    .filter(
      ([, actionGroup]) => actionGroup !== 'members' || permissions.has('projects.members.view'),
    )
    .filter(
      ([, actionGroup]) =>
        actionGroup !== 'workforce' || permissions.has('projects.workforce.view'),
    )
    // Sprint 8 (T-65): action entries for readers who see all of the project's actions.
    .filter(
      ([, actionGroup]) => actionGroup !== 'actions' || permissions.has('projects.actions.view'),
    )
    .map(([action]) => action);
}

/** `/api/v1/projects/{id}/timeline` — PLT-18. */
export const timelineRoutes = new Hono<AppEnv>().get(
  '/:id/timeline',
  signedIn,
  requireProjectPermission('projects.timeline.view'),
  validate('query', timelineQuerySchema),
  async (c) => {
    const { type, before, limit } = c.req.valid('query');
    const project = currentProject(c);
    const company = tenantCompany(c);
    const db = createDatabase(c.env.DB);
    const permissions = await permissionResolverFor(c).projectPermissions(
      c.get('principal').userId,
      company.id,
      project.id,
    );
    const { rows, next } = await new ActivityService(db).listForProject(company.id, project.id, {
      actions: visibleActions(type, permissions),
      before: parseActivityCursor(before),
      limit,
    });
    const actors = await userSummaries(
      db,
      rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])),
    );
    const body: TimelinePageDto = {
      nextBefore: next,
      items: rows.map((row): ActivityEntryDto => {
        const actor = row.actorUserId ? actors.get(row.actorUserId) : undefined;
        const action = row.action as ActivityEntryDto['action'];
        return {
          id: row.id,
          action,
          group: ACTIVITY_ACTIONS[action],
          actorName: actor?.fullName ?? null,
          actorFormer: actor ? actor.former || actor.companyId !== company.id : false,
          occurredAt: row.occurredAt.getTime(),
          changes: row.changes ? (JSON.parse(row.changes) as ActivityEntryDto['changes']) : null,
          snapshot: row.snapshot ? (JSON.parse(row.snapshot) as ActivityEntryDto['snapshot']) : {},
        };
      }),
    };
    return ok(c, body);
  },
);

/** `/api/v1/projects/switcher` — PLT-19 FR-1. Registered before `/:id`. */
export const switcherRoutes = new Hono<AppEnv>().get(
  '/switcher',
  signedIn,
  validate('query', switcherQuerySchema),
  async (c) => {
    const company = tenantCompany(c);
    const userId = c.get('principal').userId;
    const db = createDatabase(c.env.DB);
    const [access, lastProjectId] = await Promise.all([
      permissionResolverFor(c).projectAccess(userId, company.id, 'projects.view'),
      new UserPreferences(db).lastProjectId(userId),
    ]);
    const rows = await new ProjectRepository(db).listForSwitcher(company.id, {
      projectIds: access.allProjects ? null : access.projectIds,
      search: c.req.valid('query').search,
      limit: 100,
    });
    const items = rows
      .map((row) => ({ id: row.id, code: row.code, name: row.name, status: row.status }))
      .sort((a, b) =>
        a.id === lastProjectId ? -1 : b.id === lastProjectId ? 1 : a.code.localeCompare(b.code),
      );
    const visible = lastProjectId && items.some((item) => item.id === lastProjectId);
    const body: ProjectSwitcherDto = { items, lastProjectId: visible ? lastProjectId : null };
    return ok(c, body);
  },
);

/** `/api/v1/me/last-project` — PLT-19 FR-3. */
export const meRoutes = new Hono<AppEnv>().put(
  '/last-project',
  signedIn,
  validate('json', lastProjectRequestSchema),
  async (c) => {
    const company = tenantCompany(c);
    const userId = c.get('principal').userId;
    const { projectId } = c.req.valid('json');
    const db = createDatabase(c.env.DB);
    const project = await new ProjectRepository(db).find(company.id, projectId);
    if (!project) throw new NotFoundError();
    const granted = await permissionResolverFor(c).projectPermissions(
      userId,
      company.id,
      project.id,
    );
    if (!granted.has('projects.view')) throw new NotFoundError();
    await new UserPreferences(db).setLastProject(userId, project.id);
    return c.body(null, 204);
  },
);
