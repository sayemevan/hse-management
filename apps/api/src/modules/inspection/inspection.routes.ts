import {
  categoryRequestSchema,
  commentListQuerySchema,
  commentRequestSchema,
  createInspectionRequestSchema,
  createTemplateRequestSchema,
  findingListQuerySchema,
  inspectionListQuerySchema,
  inspectionTransitionRequestSchema,
  itemResultRequestSchema,
  moveRequestSchema,
  myInspectionsQuerySchema,
  noActionRequestSchema,
  raiseFindingActionRequestSchema,
  saveDraftRequestSchema,
  templateListQuerySchema,
  timelineQuerySchema,
  updateFindingRequestSchema,
  updateInspectionRequestSchema,
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
import { sha256Hex } from '../../core/security/secure-token';
import { createDatabase } from '../../database/client';
import { FILE_CATEGORIES, type OpenedFile } from '../../platform/file-storage';
import { idempotencyClaimOf, idempotent, offlineMetaOf } from '../../platform/sync';
import { permissionResolverFor, validateIdentitySession } from '../identity';
import { currentProject, ProjectDirectory, requireProjectPermission } from '../project';
import { InspectionContext, type InspectionProject } from './inspection-context';
import { InspectionService } from './inspection.service';
import { TemplateService } from './template.service';

const signedIn = authenticate(validateIdentitySession);
const onProject = requireProjectPermission('projects.view');
const idParam = z.object({ id: z.uuid() });
const versionParam = idParam.extend({ versionNo: z.coerce.number().int().min(1) });
const inspectionParam = z.object({ id: z.uuid(), inspectionId: z.uuid() });
const itemParam = inspectionParam.extend({ itemKey: z.uuid() });
const fileParam = inspectionParam.extend({ fileId: z.uuid() });
const findingParam = inspectionParam.extend({ findingId: z.uuid() });
const commentParam = inspectionParam.extend({ commentId: z.uuid() });
const historyQuery = timelineQuerySchema.pick({ before: true });

function tenantOf(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

function templates(c: Context<AppEnv>): TemplateService {
  return new TemplateService({
    db: createDatabase(c.env.DB),
    meta: requestMeta(c),
    clock: Date.now,
    resolver: permissionResolverFor(c),
  });
}

function service(c: Context<AppEnv>): InspectionService {
  return new InspectionService(
    new InspectionContext({
      db: createDatabase(c.env.DB),
      meta: requestMeta(c),
      clock: Date.now,
      bucket: c.env.FILES,
      resolver: permissionResolverFor(c),
    }),
  );
}

function serve(c: Context<AppEnv>, opened: OpenedFile | null) {
  if (!opened) throw new NotFoundError();
  const download = c.req.query('download') === 'true';
  const headers: Record<string, string> = {
    'Content-Type': opened.row.contentType,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${opened.row.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': FILE_CATEGORIES.inspection_evidence.cacheControl,
    ETag: opened.etag,
  };
  if (c.req.header('if-none-match') === opened.etag) {
    void opened.body.cancel();
    return c.body(null, 304, headers);
  }
  return c.body(opened.body, 200, { ...headers, 'Content-Length': String(opened.row.sizeBytes) });
}

/** `/api/v1/inspection-categories` — US-031 (O-141). */
export const inspectionCategoryRoutes = new Hono<AppEnv>()
  .get('/', signedIn, async (c) => ok(c, await templates(c).listCategories(tenantOf(c), c.get('principal'))))
  .post('/', signedIn, validate('json', categoryRequestSchema), async (c) =>
    created(c, await templates(c).createCategory(tenantOf(c), c.get('principal'), c.req.valid('json'))),
  )
  .patch('/:id', signedIn, validate('param', idParam), validate('json', categoryRequestSchema), async (c) =>
    ok(
      c,
      await templates(c).updateCategory(tenantOf(c), c.get('principal'), c.req.valid('param').id, c.req.valid('json')),
    ),
  )
  .post('/:id/move', signedIn, validate('param', idParam), validate('json', moveRequestSchema), async (c) =>
    ok(
      c,
      await templates(c).moveCategory(
        tenantOf(c),
        c.get('principal'),
        c.req.valid('param').id,
        c.req.valid('json').direction,
      ),
    ),
  )
  .post('/:id/deactivate', signedIn, validate('param', idParam), async (c) =>
    ok(c, await templates(c).setCategoryActive(tenantOf(c), c.get('principal'), c.req.valid('param').id, false)),
  )
  .post('/:id/reactivate', signedIn, validate('param', idParam), async (c) =>
    ok(c, await templates(c).setCategoryActive(tenantOf(c), c.get('principal'), c.req.valid('param').id, true)),
  );

/** `/api/v1/inspection-templates` — US-031, US-032 and the device pack (T-80). */
export const inspectionTemplateRoutes = new Hono<AppEnv>()
  .get('/', signedIn, validate('query', templateListQuerySchema), async (c) =>
    ok(c, await templates(c).list(tenantOf(c), c.get('principal'), c.req.valid('query'))),
  )
  .get('/offline-pack', signedIn, async (c) => {
    const pack = await templates(c).pack(tenantOf(c), c.get('principal'));
    const etag = `"${(await sha256Hex(JSON.stringify(pack.versions))).slice(0, 32)}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, { ETag: etag });
    c.header('ETag', etag);
    c.header('Cache-Control', 'private, no-cache');
    return ok(c, pack);
  })
  .post('/', signedIn, validate('json', createTemplateRequestSchema), async (c) =>
    created(c, await templates(c).create(tenantOf(c), c.get('principal'), c.req.valid('json')), {
      message: 'Template created',
    }),
  )
  .get('/:id', signedIn, validate('param', idParam), async (c) =>
    ok(c, await templates(c).detail(tenantOf(c), c.get('principal'), c.req.valid('param').id)),
  )
  .delete('/:id', signedIn, validate('param', idParam), async (c) => {
    await templates(c).remove(tenantOf(c), c.get('principal'), c.req.valid('param').id);
    return c.body(null, 204);
  })
  .put('/:id/draft', signedIn, validate('param', idParam), validate('json', saveDraftRequestSchema), async (c) =>
    ok(c, await templates(c).saveDraft(tenantOf(c), c.get('principal'), c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/:id/draft', signedIn, validate('param', idParam), async (c) =>
    created(c, await templates(c).createDraft(tenantOf(c), c.get('principal'), c.req.valid('param').id)),
  )
  .delete('/:id/draft', signedIn, validate('param', idParam), async (c) => {
    await templates(c).discardDraft(tenantOf(c), c.get('principal'), c.req.valid('param').id);
    return c.body(null, 204);
  })
  .post('/:id/publish', signedIn, validate('param', idParam), async (c) =>
    ok(c, await templates(c).publish(tenantOf(c), c.get('principal'), c.req.valid('param').id), {
      message: 'Template published',
    }),
  )
  .post('/:id/retire', signedIn, validate('param', idParam), async (c) =>
    ok(c, await templates(c).setRetired(tenantOf(c), c.get('principal'), c.req.valid('param').id, true)),
  )
  .post('/:id/reactivate', signedIn, validate('param', idParam), async (c) =>
    ok(c, await templates(c).setRetired(tenantOf(c), c.get('principal'), c.req.valid('param').id, false)),
  )
  .post('/:id/duplicate', signedIn, validate('param', idParam), async (c) =>
    created(c, await templates(c).duplicate(tenantOf(c), c.get('principal'), c.req.valid('param').id)),
  )
  .get('/:id/versions', signedIn, validate('param', idParam), async (c) =>
    ok(c, await templates(c).versions(tenantOf(c), c.get('principal'), c.req.valid('param').id)),
  )
  .get('/:id/versions/:versionNo', signedIn, validate('param', versionParam), async (c) => {
    const { id, versionNo } = c.req.valid('param');
    return ok(c, await templates(c).version(tenantOf(c), c.get('principal'), id, versionNo));
  });

// ---- Idempotent replays (T-69): each route reads its own resource --------------------------

const replayInspection = idempotent({
  companyIdOf: (c) => tenantOf(c).id,
  read: (c, id) => service(c).detail(tenantOf(c), currentProject(c), c.get('principal'), id),
});

const replayItem = idempotent({
  companyIdOf: (c) => tenantOf(c).id,
  read: async (c, resourceId) => {
    const [inspectionId, itemKey] = resourceId.split(':');
    const dto = await service(c).detail(tenantOf(c), currentProject(c), c.get('principal'), inspectionId ?? '');
    return dto.items.find((item) => item.itemKey === itemKey);
  },
});

const replayFile = idempotent({
  companyIdOf: (c) => tenantOf(c).id,
  read: (c, linkId) =>
    service(c).fileDto(tenantOf(c), currentProject(c), c.get('principal'), c.req.param('inspectionId') ?? '', linkId),
});

/** `/api/v1/projects/{id}/inspections` — PLT-32, US-033 – US-039. */
export const projectInspectionRoutes = new Hono<AppEnv>()
  .get('/:id/inspections', signedIn, onProject, validate('query', inspectionListQuerySchema), async (c) =>
    ok(c, await service(c).list(tenantOf(c), currentProject(c), c.get('principal'), c.req.valid('query'))),
  )
  .get('/:id/inspection-findings', signedIn, onProject, validate('query', findingListQuerySchema), async (c) =>
    ok(c, await service(c).projectFindings(tenantOf(c), currentProject(c), c.get('principal'), c.req.valid('query'))),
  )
  .post(
    '/:id/inspections',
    signedIn,
    onProject,
    replayInspection,
    validate('json', createInspectionRequestSchema),
    async (c) => {
      const result = await service(c).create(
        tenantOf(c),
        currentProject(c),
        c.get('principal'),
        c.req.valid('json'),
        idempotencyClaimOf(c),
        offlineMetaOf(c, Date.now()),
      );
      return created(c, result.dto, { message: result.replayed ? 'Already applied' : 'Inspection created' });
    },
  )
  .get('/:id/inspections/:inspectionId', signedIn, onProject, validate('param', inspectionParam), async (c) =>
    ok(
      c,
      await service(c).detail(tenantOf(c), currentProject(c), c.get('principal'), c.req.valid('param').inspectionId),
    ),
  )
  .patch(
    '/:id/inspections/:inspectionId',
    signedIn,
    onProject,
    validate('param', inspectionParam),
    replayInspection,
    validate('json', updateInspectionRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).update(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').inspectionId,
          c.req.valid('json'),
          idempotencyClaimOf(c),
          offlineMetaOf(c, Date.now()),
        ),
      ),
  )
  .put(
    '/:id/inspections/:inspectionId/items/:itemKey',
    signedIn,
    onProject,
    validate('param', itemParam),
    replayItem,
    validate('json', itemResultRequestSchema),
    async (c) => {
      const { inspectionId, itemKey } = c.req.valid('param');
      return ok(
        c,
        await service(c).saveItem(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          inspectionId,
          itemKey,
          c.req.valid('json'),
          idempotencyClaimOf(c),
          offlineMetaOf(c, Date.now()),
        ),
      );
    },
  )
  .post(
    '/:id/inspections/:inspectionId/files',
    signedIn,
    onProject,
    validate('param', inspectionParam),
    replayFile,
    async (c) => {
      const form = await c.req.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) throw new ValidationError([{ path: 'file', message: 'required' }]);
      const itemKey = form?.get('itemKey');
      const key = typeof itemKey === 'string' && itemKey !== '' ? itemKey : null;
      if (key !== null && !z.uuid().safeParse(key).success) {
        throw new ValidationError([{ path: 'itemKey', message: 'invalid' }]);
      }
      return created(
        c,
        await service(c).addFile(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').inspectionId,
          file,
          key,
          idempotencyClaimOf(c),
          offlineMetaOf(c, Date.now()),
        ),
      );
    },
  )
  .get('/:id/inspections/:inspectionId/files/:fileId', signedIn, onProject, validate('param', fileParam), async (c) => {
    const { inspectionId, fileId } = c.req.valid('param');
    return serve(c, await service(c).openFile(tenantOf(c), currentProject(c), c.get('principal'), inspectionId, fileId));
  })
  .delete(
    '/:id/inspections/:inspectionId/files/:fileId',
    signedIn,
    onProject,
    validate('param', fileParam),
    async (c) => {
      const { inspectionId, fileId } = c.req.valid('param');
      await service(c).removeFile(tenantOf(c), currentProject(c), c.get('principal'), inspectionId, fileId);
      return c.body(null, 204);
    },
  )
  .get('/:id/inspections/:inspectionId/readiness', signedIn, onProject, validate('param', inspectionParam), async (c) =>
    ok(
      c,
      await service(c).readiness(tenantOf(c), currentProject(c), c.get('principal'), c.req.valid('param').inspectionId),
    ),
  )
  .post('/:id/inspections/:inspectionId/review-start', signedIn, onProject, validate('param', inspectionParam), async (c) => {
    await service(c).reviewStart(tenantOf(c), currentProject(c), c.get('principal'), c.req.valid('param').inspectionId);
    return c.body(null, 204);
  })
  .post(
    '/:id/inspections/:inspectionId/transitions',
    signedIn,
    onProject,
    validate('param', inspectionParam),
    replayInspection,
    validate('json', inspectionTransitionRequestSchema),
    async (c) =>
      ok(
        c,
        await service(c).transition(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').inspectionId,
          c.req.valid('json'),
          idempotencyClaimOf(c),
          offlineMetaOf(c, Date.now()),
        ),
      ),
  )
  .patch(
    '/:id/inspections/:inspectionId/findings/:findingId',
    signedIn,
    onProject,
    validate('param', findingParam),
    validate('json', updateFindingRequestSchema),
    async (c) => {
      const { inspectionId, findingId } = c.req.valid('param');
      return ok(
        c,
        await service(c).updateFinding(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          inspectionId,
          findingId,
          c.req.valid('json'),
        ),
      );
    },
  )
  .post(
    '/:id/inspections/:inspectionId/findings/:findingId/actions',
    signedIn,
    onProject,
    validate('param', findingParam),
    validate('json', raiseFindingActionRequestSchema),
    async (c) => {
      const { inspectionId, findingId } = c.req.valid('param');
      return created(
        c,
        await service(c).raiseAction(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          inspectionId,
          findingId,
          c.req.valid('json'),
        ),
      );
    },
  )
  .post(
    '/:id/inspections/:inspectionId/findings/:findingId/no-action',
    signedIn,
    onProject,
    validate('param', findingParam),
    validate('json', noActionRequestSchema),
    async (c) => {
      const { inspectionId, findingId } = c.req.valid('param');
      return ok(
        c,
        await service(c).noAction(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          inspectionId,
          findingId,
          c.req.valid('json').reason,
        ),
      );
    },
  )
  .get(
    '/:id/inspections/:inspectionId/history',
    signedIn,
    onProject,
    validate('param', inspectionParam),
    validate('query', historyQuery),
    async (c) =>
      ok(
        c,
        await service(c).history(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').inspectionId,
          c.req.valid('query').before,
        ),
      ),
  )
  .get(
    '/:id/inspections/:inspectionId/comments',
    signedIn,
    onProject,
    validate('param', inspectionParam),
    validate('query', commentListQuerySchema),
    async (c) =>
      ok(
        c,
        await service(c).comments(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').inspectionId,
          c.req.valid('query').before,
        ),
      ),
  )
  .post(
    '/:id/inspections/:inspectionId/comments',
    signedIn,
    onProject,
    validate('param', inspectionParam),
    validate('json', commentRequestSchema),
    async (c) =>
      created(
        c,
        await service(c).addComment(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          c.req.valid('param').inspectionId,
          c.req.valid('json').body,
        ),
      ),
  )
  .patch(
    '/:id/inspections/:inspectionId/comments/:commentId',
    signedIn,
    onProject,
    validate('param', commentParam),
    validate('json', commentRequestSchema),
    async (c) => {
      const { inspectionId, commentId } = c.req.valid('param');
      return ok(
        c,
        await service(c).editComment(
          tenantOf(c),
          currentProject(c),
          c.get('principal'),
          inspectionId,
          commentId,
          c.req.valid('json').body,
        ),
      );
    },
  );

/** `/api/v1/me/inspections` — US-033 My inspections. */
export const inspectionMeRoutes = new Hono<AppEnv>().get(
  '/inspections',
  signedIn,
  validate('query', myInspectionsQuerySchema),
  async (c) => {
    const tenant = tenantOf(c);
    const principal = c.get('principal');
    const db = createDatabase(c.env.DB);
    const resolver = permissionResolverFor(c);
    return ok(
      c,
      await service(c).mine(tenant, principal, c.req.valid('query'), async (ids) => {
        const access = await resolver.projectAccess(principal.userId, tenant.id, 'projects.view');
        const facts = await new ProjectDirectory(db).getMany(tenant.id, ids);
        const result = new Map<string, InspectionProject>();
        for (const [id, project] of facts) {
          if (project.status === 'archived') continue;
          if (!access.allProjects && !access.projectIds.includes(id)) continue;
          result.set(id, { id, code: project.code, status: project.status });
        }
        return result;
      }),
    );
  },
);
