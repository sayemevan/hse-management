import {
  actionCandidatesQuerySchema,
  actionListQuerySchema,
  addCollaboratorsRequestSchema,
  changeOwnerRequestSchema,
  commentListQuerySchema,
  commentRequestSchema,
  createActionRequestSchema,
  myActionsQuerySchema,
  progressRequestSchema,
  timelineQuerySchema,
  transitionRequestSchema,
  updateActionRequestSchema,
  voidActionRequestSchema,
} from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { created, ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import { FILE_CATEGORIES, type OpenedFile } from '../../platform/file-storage';
import { permissionResolverFor, validateIdentitySession } from '../identity';
import { currentProject, requireProjectPermission } from '../project';
import { ActionContext } from './action-context';
import { ActionService } from './action.service';

const signedIn = authenticate(validateIdentitySession);
/** T-65: the project guard only needs `projects.view`; the service applies the action rules. */
const onProject = requireProjectPermission('projects.view');
const actionParam = z.object({ id: z.uuid(), actionId: z.uuid() });
const fileParam = actionParam.extend({ fileId: z.uuid() });
const collaboratorParam = actionParam.extend({ userId: z.uuid() });
const commentParam = actionParam.extend({ commentId: z.uuid() });
const historyQuery = timelineQuerySchema.pick({ before: true });

function tenantOf(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

function service(c: Context<AppEnv>): ActionService {
  return new ActionService(
    new ActionContext({
      db: createDatabase(c.env.DB),
      meta: requestMeta(c),
      clock: Date.now,
      bucket: c.env.FILES,
      resolver: permissionResolverFor(c),
    }),
  );
}

/** PLT-07 FR-6 headers, as the other file routes. */
function serve(c: Context<AppEnv>, opened: OpenedFile | null, download: boolean) {
  if (!opened) throw new NotFoundError();
  const headers: Record<string, string> = {
    'Content-Type': opened.row.contentType,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${opened.row.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': FILE_CATEGORIES.action_evidence.cacheControl,
    ETag: opened.etag,
  };
  if (c.req.header('if-none-match') === opened.etag) {
    void opened.body.cancel();
    return c.body(null, 304, headers);
  }
  return c.body(opened.body, 200, { ...headers, 'Content-Length': String(opened.row.sizeBytes) });
}

/** `/api/v1/projects/{id}/actions` — PLT-22 – PLT-24, US-053 – US-058. */
export const projectActionRoutes = new Hono<AppEnv>()
  // ---- Lists (PLT-24) ---------------------------------------------------------------------
  .get(
    '/:id/actions',
    signedIn,
    onProject,
    validate('query', actionListQuerySchema),
    async (c) =>
      ok(
        c,
        await service(c).list(tenantOf(c), currentProject(c), c.get('principal'), c.req.valid('query')),
      ),
  )
  .get('/:id/actions/summary', signedIn, onProject, async (c) =>
    ok(c, await service(c).summary(tenantOf(c), currentProject(c), c.get('principal'))),
  )
  .get(
    '/:id/actions/candidates',
    signedIn,
    onProject,
    validate('query', actionCandidatesQuerySchema),
    async (c) =>
      ok(
        c,
        await service(c).candidates(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('query').search,
        ),
      ),
  )
  // ---- Create, read, edit (US-053) --------------------------------------------------------
  .post(
    '/:id/actions',
    signedIn,
    onProject,
    validate('json', createActionRequestSchema),
    async (c) =>
      created(
        c,
        await service(c).create(tenantOf(c), currentProject(c), c.get('principal'), c.req.valid('json')),
        { message: 'Action created' },
      ),
  )
  .get('/:id/actions/:actionId', signedIn, onProject, validate('param', actionParam), async (c) =>
    ok(
      c,
      await service(c).detail(
        tenantOf(c),
        currentProject(c),
        c.get('principal'),
        c.req.valid('param').actionId,
      ),
    ),
  )
  .patch(
    '/:id/actions/:actionId',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('json', updateActionRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).update(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('json'),
        ),
        { message: 'Action updated' },
      ),
  )
  .get(
    '/:id/actions/:actionId/history',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('query', historyQuery),
    async (c) =>
      ok(
        c,
        await service(c).history(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('query').before,
        ),
      ),
  )
  // ---- Owner and collaborators (US-054) ---------------------------------------------------
  .post(
    '/:id/actions/:actionId/owner',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('json', changeOwnerRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).changeOwner(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('json'),
        ),
        { message: 'Owner changed' },
      ),
  )
  .post(
    '/:id/actions/:actionId/collaborators',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('json', addCollaboratorsRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).addCollaborators(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('json'),
        ),
      ),
  )
  .delete(
    '/:id/actions/:actionId/collaborators/:userId',
    signedIn,
    onProject,
    validate('param', collaboratorParam),
    async (c) => {
      const { actionId, userId } = c.req.valid('param');
      await service(c).removeCollaborator(
        tenantOf(c),
        currentProject(c),
        c.get('principal'),
        actionId,
        userId,
      );
      return c.body(null, 204);
    },
  )
  // ---- Progress, files and the workflow (US-055 – US-058) ---------------------------------
  .post(
    '/:id/actions/:actionId/updates',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('json', progressRequestSchema),
    async (c) =>
      created(
        c,
        await service(c).addProgress(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('json'),
        ),
      ),
  )
  .post(
    '/:id/actions/:actionId/files',
    signedIn,
    onProject,
    validate('param', actionParam),
    async (c) => {
      const form = await c.req.formData().catch(() => null);
      if (!form) throw new ValidationError([{ path: 'files', message: 'required' }]);
      const uploads = form
        .getAll('files')
        .filter((entry): entry is File => entry instanceof File && entry.size >= 0);
      return created(
        c,
        await service(c).uploadFiles(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          uploads,
        ),
      );
    },
  )
  .get(
    '/:id/actions/:actionId/files/:fileId',
    signedIn,
    onProject,
    validate('param', fileParam),
    async (c) => {
      const { actionId, fileId } = c.req.valid('param');
      const opened = await service(c).openFile(
        tenantOf(c),
        currentProject(c),
        c.get('principal'),
        actionId,
        fileId,
      );
      return serve(c, opened, c.req.query('download') === '1');
    },
  )
  .post(
    '/:id/actions/:actionId/transitions',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('json', transitionRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).transition(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('json'),
        ),
      ),
  )
  .post(
    '/:id/actions/:actionId/void',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('json', voidActionRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).void(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('json').reason,
        ),
        { message: 'Action voided' },
      ),
  )
  // ---- Comments (PLT-22) ------------------------------------------------------------------
  .get(
    '/:id/actions/:actionId/comments',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('query', commentListQuerySchema),
    async (c) =>
      ok(
        c,
        await service(c).comments(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('query').before,
        ),
      ),
  )
  .post(
    '/:id/actions/:actionId/comments',
    signedIn,
    onProject,
    validate('param', actionParam),
    validate('json', commentRequestSchema),
    async (c) =>
      created(
        c,
        await service(c).addComment(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').actionId,
          c.req.valid('json').body,
        ),
      ),
  )
  .patch(
    '/:id/actions/:actionId/comments/:commentId',
    signedIn,
    onProject,
    validate('param', commentParam),
    validate('json', commentRequestSchema),
    async (c) => {
      const { actionId, commentId } = c.req.valid('param');
      return ok(
        c,
        await service(c).editComment(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          actionId,
          commentId,
          c.req.valid('json').body,
        ),
      );
    },
  );

/** `/api/v1/me/actions` — PLT-24 My actions. */
export const actionMeRoutes = new Hono<AppEnv>()
  .get('/actions/summary', signedIn, async (c) =>
    ok(c, await service(c).mineSummary(tenantOf(c), c.get('principal'))),
  )
  .get('/actions', signedIn, validate('query', myActionsQuerySchema), async (c) =>
    ok(c, await service(c).mine(tenantOf(c), c.get('principal'), c.req.valid('query'))),
  );
