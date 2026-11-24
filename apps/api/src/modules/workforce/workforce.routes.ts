import {
  type ActivityEntryDto,
  ACTIVITY_ACTIONS,
  assignWorkforceRequestSchema,
  createWorkforceMemberRequestSchema,
  emergencyContactsRequestSchema,
  endAssignmentRequestSchema,
  projectWorkforceQuerySchema,
  RECORD_KIND_PATHS,
  RECORD_KINDS,
  type RecordKind,
  recordListQuerySchema,
  recordRequestSchemas,
  updateAssignmentRequestSchema,
  updateWorkforceMemberRequestSchema,
  voidRecordRequestSchema,
  WORKFORCE_LISTS,
  workforceCandidatesQuerySchema,
  workforceHistoryQuerySchema,
  workforceListItemRequestSchema,
  workforceListQueryParamsSchema,
  workforceListQuerySchema,
  workforceStatusRequestSchema,
  workforceSuggestionQuerySchema,
  workforceUserLinkRequestSchema,
} from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import type { TenantCompany } from '../../core/context/tenant';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/app-error';
import { requestMeta } from '../../core/http/request-meta';
import { created, ok } from '../../core/http/response';
import { toIssues, validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import { parseActivityCursor } from '../../platform/activity';
import { FILE_CATEGORIES, type FileCategory, type OpenedFile } from '../../platform/file-storage';
import {
  permissionResolverFor,
  userSummaries,
  validateIdentitySession,
  WorkforceUserLinks,
} from '../identity';
import { currentProject, requireProjectPermission } from '../project';
import { AssignmentService } from './assignment.service';
import { ContactService } from './contact.service';
import { MemberService } from './member.service';
import { RecordService } from './record.service';
import { loadWorkforceAccess, mayRead, type WorkforceAccess } from './workforce-access';
import { WorkforceContext } from './workforce-context';

const signedIn = authenticate(validateIdentitySession);
const memberParam = z.object({ memberId: z.uuid() });
const listParam = z.object({ list: z.enum(WORKFORCE_LISTS) });
const listItemParam = z.object({ list: z.enum(WORKFORCE_LISTS), itemId: z.uuid() });
const assignmentParam = z.object({ id: z.uuid(), assignmentId: z.uuid() });
const KIND_BY_PATH = new Map(RECORD_KINDS.map((kind) => [RECORD_KIND_PATHS[kind], kind] as const));
const recordPathParam = z.object({
  memberId: z.uuid(),
  kind: z.enum(Object.values(RECORD_KIND_PATHS) as [string, ...string[]]),
});
const recordParam = recordPathParam.extend({ recordId: z.uuid() });

function tenantOf(c: Context<AppEnv>): TenantCompany {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

function contextOf(c: Context<AppEnv>): WorkforceContext {
  return new WorkforceContext({
    db: createDatabase(c.env.DB),
    meta: requestMeta(c),
    clock: Date.now,
    bucket: c.env.FILES,
    resolver: permissionResolverFor(c),
  });
}

const accessCache = new WeakMap<Request, Promise<WorkforceAccess>>();

function accessOf(c: Context<AppEnv>): Promise<WorkforceAccess> {
  let found = accessCache.get(c.req.raw);
  if (!found) {
    found = loadWorkforceAccess(
      createDatabase(c.env.DB),
      permissionResolverFor(c),
      c.get('principal').userId,
      tenantOf(c).id,
    );
    accessCache.set(c.req.raw, found);
  }
  return found;
}

async function requireAccess(
  c: Context<AppEnv>,
  check: (access: WorkforceAccess) => boolean,
): Promise<WorkforceAccess> {
  const access = await accessOf(c);
  if (!check(access)) {
    c.get('logger').info('permission denied', { scope: 'workforce' });
    throw new ForbiddenError();
  }
  return access;
}

/** The profile, if the caller may see it at all (`workforce.view` or their own, O-85). */
async function memberFor(c: Context<AppEnv>, memberId: string) {
  const access = await accessOf(c);
  if (!mayRead(access, memberId, 'view')) throw new NotFoundError();
  const member = await new MemberService(contextOf(c)).required(tenantOf(c), memberId);
  return { access, member };
}

function kindOf(path: string): RecordKind {
  const kind = KIND_BY_PATH.get(path);
  if (!kind) throw new NotFoundError();
  return kind;
}

/** Streams a stored file with safe headers (PLT-07 FR-6), as the company routes do. */
function serve(
  c: Context<AppEnv>,
  opened: OpenedFile | null,
  disposition: 'inline' | 'attachment' = 'inline',
) {
  if (!opened) throw new NotFoundError();
  const category = FILE_CATEGORIES[opened.row.category as FileCategory] as
    (typeof FILE_CATEGORIES)[FileCategory] | undefined;
  const headers: Record<string, string> = {
    'Content-Type': opened.row.contentType,
    'Content-Disposition': `${disposition}; filename="${opened.row.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': category?.cacheControl ?? 'private, no-store',
    ETag: opened.etag,
  };
  if (c.req.header('if-none-match') === opened.etag) {
    void opened.body.cancel();
    return c.body(null, 304, headers);
  }
  return c.body(opened.body, 200, { ...headers, 'Content-Length': String(opened.row.sizeBytes) });
}

/** Multipart record form: `data` (JSON of the fields) and an optional `file` (US-026 – US-030). */
async function recordForm(c: Context<AppEnv>, kind: RecordKind) {
  const form = await c.req.formData().catch(() => null);
  if (!form) throw new ValidationError([{ path: 'data', message: 'required' }]);
  const raw = form.get('data');
  let json: unknown = {};
  if (typeof raw === 'string' && raw !== '') {
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ValidationError([{ path: 'data', message: 'invalidJson' }]);
    }
  }
  const parsed = recordRequestSchemas[kind].safeParse(json);
  if (!parsed.success) throw new ValidationError(toIssues(parsed.error.issues));
  const upload = form.get('file');
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  const removeFile =
    typeof json === 'object' &&
    json !== null &&
    (json as { removeFile?: unknown }).removeFile === true;
  return { input: parsed.data, file, removeFile };
}

/** `/api/v1/workforce` — US-024 – US-030, PLT-20, PLT-21. */
export const workforceRoutes = new Hono<AppEnv>()
  // ---- Directory and summary (US-024 FR-1, PLT-20) -----------------------------------
  .get('/', signedIn, validate('query', workforceListQuerySchema), async (c) => {
    const access = await requireAccess(c, (a) => a.view);
    const query = c.req.valid('query');
    return ok(c, await new MemberService(contextOf(c)).list(tenantOf(c), access, query));
  })
  .get('/summary', signedIn, async (c) => {
    const access = await requireAccess(c, (a) => a.view);
    return ok(c, await new MemberService(contextOf(c)).summary(tenantOf(c), access));
  })
  .get('/suggestions', signedIn, validate('query', workforceSuggestionQuerySchema), async (c) => {
    await requireAccess(c, (a) => a.manage);
    const { field, q } = c.req.valid('query');
    return ok(c, { items: await contextOf(c).repo.suggestions(tenantOf(c).id, field, q) });
  })
  .get(
    '/user-candidates',
    signedIn,
    validate('query', workforceCandidatesQuerySchema),
    async (c) => {
      await requireAccess(c, (a) => a.manage && a.users);
      return ok(c, {
        items: await new WorkforceUserLinks(createDatabase(c.env.DB)).candidates(
          tenantOf(c).id,
          c.req.valid('query').search,
        ),
      });
    },
  )

  // ---- Lists (PLT-21) -----------------------------------------------------------------
  .get(
    '/lists/:list',
    signedIn,
    validate('param', listParam),
    validate('query', workforceListQueryParamsSchema),
    async (c) => {
      const access = await accessOf(c);
      const items = await contextOf(c).lists.items(tenantOf(c).id, c.req.valid('param').list, {
        includeInactive: c.req.valid('query').includeInactive,
        withUsage: access.lists,
      });
      return ok(c, { items });
    },
  )
  .post(
    '/lists/:list',
    signedIn,
    validate('param', listParam),
    validate('json', workforceListItemRequestSchema),
    async (c) => {
      await requireAccess(c, (a) => a.lists);
      const item = await contextOf(c).lists.create(
        tenantOf(c).id,
        c.get('principal'),
        c.req.valid('param').list,
        c.req.valid('json').name,
      );
      return created(c, item, { message: 'Item added' });
    },
  )
  .patch(
    '/lists/:list/:itemId',
    signedIn,
    validate('param', listItemParam),
    validate('json', workforceListItemRequestSchema),
    async (c) => {
      await requireAccess(c, (a) => a.lists);
      const { list, itemId } = c.req.valid('param');
      const item = await contextOf(c).lists.rename(
        tenantOf(c).id,
        c.get('principal'),
        list,
        itemId,
        c.req.valid('json').name,
      );
      return ok(c, item, { message: 'Item saved' });
    },
  )
  .post(
    '/lists/:list/:itemId/move',
    signedIn,
    validate('param', listItemParam),
    validate('json', z.object({ direction: z.enum(['up', 'down']) })),
    async (c) => {
      await requireAccess(c, (a) => a.lists);
      const { list, itemId } = c.req.valid('param');
      await contextOf(c).lists.move(
        tenantOf(c).id,
        c.get('principal'),
        list,
        itemId,
        c.req.valid('json').direction,
      );
      return c.body(null, 204);
    },
  )
  .post(
    '/lists/:list/:itemId/deactivate',
    signedIn,
    validate('param', listItemParam),
    async (c) => {
      await requireAccess(c, (a) => a.lists);
      const { list, itemId } = c.req.valid('param');
      await contextOf(c).lists.setActive(tenantOf(c).id, c.get('principal'), list, itemId, false);
      return c.body(null, 204);
    },
  )
  .post(
    '/lists/:list/:itemId/reactivate',
    signedIn,
    validate('param', listItemParam),
    async (c) => {
      await requireAccess(c, (a) => a.lists);
      const { list, itemId } = c.req.valid('param');
      await contextOf(c).lists.setActive(tenantOf(c).id, c.get('principal'), list, itemId, true);
      return c.body(null, 204);
    },
  )
  .delete('/lists/:list/:itemId', signedIn, validate('param', listItemParam), async (c) => {
    await requireAccess(c, (a) => a.lists);
    const { list, itemId } = c.req.valid('param');
    await contextOf(c).lists.delete(tenantOf(c).id, c.get('principal'), list, itemId);
    return c.body(null, 204);
  })

  // ---- Profiles (US-024) --------------------------------------------------------------
  .post('/', signedIn, validate('json', createWorkforceMemberRequestSchema), async (c) => {
    const access = await requireAccess(c, (a) => a.manage);
    const service = new MemberService(contextOf(c));
    const input = c.req.valid('json');
    // O-80: the form asks for people with the same name and nationality before saving.
    if (c.req.query('dryRun') === 'true') {
      return ok(c, await service.duplicates(tenantOf(c), input));
    }
    return created(c, await service.create(tenantOf(c), access, c.get('principal'), input), {
      message: 'Person added',
    });
  })
  .get('/:memberId', signedIn, validate('param', memberParam), async (c) => {
    const { access, member } = await memberFor(c, c.req.valid('param').memberId);
    return ok(c, await new MemberService(contextOf(c)).get(tenantOf(c), access, member.id));
  })
  .patch(
    '/:memberId',
    signedIn,
    validate('param', memberParam),
    validate('json', updateWorkforceMemberRequestSchema),
    async (c) => {
      const { access, member } = await memberFor(c, c.req.valid('param').memberId);
      if (!access.manage) throw new ForbiddenError();
      const dto = await new MemberService(contextOf(c)).update(
        tenantOf(c),
        access,
        c.get('principal'),
        member.id,
        c.req.valid('json'),
      );
      return ok(c, dto, { message: 'Details saved' });
    },
  )
  .post(
    '/:memberId/status',
    signedIn,
    validate('param', memberParam),
    validate('json', workforceStatusRequestSchema),
    async (c) => {
      const { access, member } = await memberFor(c, c.req.valid('param').memberId);
      if (!access.manage) throw new ForbiddenError();
      const dto = await new MemberService(contextOf(c)).changeStatus(
        tenantOf(c),
        access,
        c.get('principal'),
        member.id,
        c.req.valid('json'),
      );
      return ok(c, dto, { message: 'Status changed' });
    },
  )
  .post('/:memberId/archive', signedIn, validate('param', memberParam), async (c) => {
    const { access, member } = await memberFor(c, c.req.valid('param').memberId);
    if (!access.manage) throw new ForbiddenError();
    const dto = await new MemberService(contextOf(c)).archive(
      tenantOf(c),
      access,
      c.get('principal'),
      member.id,
    );
    return ok(c, dto, { message: 'Profile archived' });
  })
  .post('/:memberId/restore', signedIn, validate('param', memberParam), async (c) => {
    const { access, member } = await memberFor(c, c.req.valid('param').memberId);
    if (!access.manage) throw new ForbiddenError();
    const dto = await new MemberService(contextOf(c)).restore(
      tenantOf(c),
      access,
      c.get('principal'),
      member.id,
    );
    return ok(c, dto, { message: 'Profile restored' });
  })
  .get('/:memberId/photo', signedIn, validate('param', memberParam), async (c) => {
    const access = await accessOf(c);
    const opened = await new MemberService(contextOf(c)).openPhoto(
      tenantOf(c),
      access,
      c.req.valid('param').memberId,
    );
    return serve(c, opened);
  })
  .put('/:memberId/photo', signedIn, validate('param', memberParam), async (c) => {
    const { access, member } = await memberFor(c, c.req.valid('param').memberId);
    if (!access.manage) throw new ForbiddenError();
    const form = await c.req.formData().catch(() => null);
    const upload = form?.get('file');
    if (!(upload instanceof File))
      throw new ValidationError([{ path: 'file', message: 'required' }]);
    const result = await new MemberService(contextOf(c)).setPhoto(
      tenantOf(c),
      c.get('principal'),
      member.id,
      upload,
    );
    return ok(c, result, { message: 'Photo saved' });
  })
  .delete('/:memberId/photo', signedIn, validate('param', memberParam), async (c) => {
    const { access, member } = await memberFor(c, c.req.valid('param').memberId);
    if (!access.manage) throw new ForbiddenError();
    await new MemberService(contextOf(c)).removePhoto(tenantOf(c), c.get('principal'), member.id);
    return c.body(null, 204);
  })
  .put(
    '/:memberId/user-link',
    signedIn,
    validate('param', memberParam),
    validate('json', workforceUserLinkRequestSchema),
    async (c) => {
      const { access, member } = await memberFor(c, c.req.valid('param').memberId);
      if (!access.manage || !access.users) throw new ForbiddenError();
      const dto = await new MemberService(contextOf(c)).link(
        tenantOf(c),
        access,
        c.get('principal'),
        member.id,
        c.req.valid('json').userId,
      );
      return ok(c, dto, { message: 'Account linked' });
    },
  )
  .delete('/:memberId/user-link', signedIn, validate('param', memberParam), async (c) => {
    const { access, member } = await memberFor(c, c.req.valid('param').memberId);
    if (!access.manage || !access.users) throw new ForbiddenError();
    const dto = await new MemberService(contextOf(c)).unlink(
      tenantOf(c),
      access,
      c.get('principal'),
      member.id,
    );
    return ok(c, dto, { message: 'Account unlinked' });
  })
  .get(
    '/:memberId/history',
    signedIn,
    validate('param', memberParam),
    validate('query', workforceHistoryQuerySchema),
    async (c) => {
      const { access, member } = await memberFor(c, c.req.valid('param').memberId);
      const ctx = contextOf(c);
      const tenant = tenantOf(c);
      const { rows, next } = await ctx.activity.listForEntity(
        tenant.id,
        { type: 'workforce_member', id: member.id },
        { before: parseActivityCursor(c.req.valid('query').before), limit: 25 },
      );
      // T-56: documents and medical entries only for readers of personal data.
      const personal = mayRead(access, member.id, 'personal');
      const visible = rows.filter((row) => {
        if (personal) return true;
        const snapshot = row.snapshot ? (JSON.parse(row.snapshot) as { recordKind?: string }) : {};
        return snapshot.recordKind !== 'document' && snapshot.recordKind !== 'medical';
      });
      const actors = await userSummaries(
        ctx.db,
        visible.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])),
      );
      return ok(c, {
        nextBefore: next,
        items: visible.map((row): ActivityEntryDto => {
          const actor = row.actorUserId ? actors.get(row.actorUserId) : undefined;
          const action = row.action as ActivityEntryDto['action'];
          return {
            id: row.id,
            action,
            group: ACTIVITY_ACTIONS[action],
            actorName: actor?.fullName ?? null,
            actorFormer: actor ? actor.former || actor.companyId !== tenant.id : false,
            occurredAt: row.occurredAt.getTime(),
            changes: row.changes ? (JSON.parse(row.changes) as ActivityEntryDto['changes']) : null,
            snapshot: row.snapshot
              ? (JSON.parse(row.snapshot) as ActivityEntryDto['snapshot'])
              : {},
          };
        }),
      });
    },
  )
  .get('/:memberId/assignments', signedIn, validate('param', memberParam), async (c) => {
    const { member } = await memberFor(c, c.req.valid('param').memberId);
    return ok(c, await new AssignmentService(contextOf(c)).ofMember(tenantOf(c), member.id));
  })

  // ---- Emergency contacts (US-029) ----------------------------------------------------
  .get('/:memberId/emergency-contacts', signedIn, validate('param', memberParam), async (c) => {
    const { access, member } = await memberFor(c, c.req.valid('param').memberId);
    return ok(c, await new ContactService(contextOf(c)).list(access, member));
  })
  .put(
    '/:memberId/emergency-contacts',
    signedIn,
    validate('param', memberParam),
    validate('json', emergencyContactsRequestSchema),
    async (c) => {
      const { access, member } = await memberFor(c, c.req.valid('param').memberId);
      const result = await new ContactService(contextOf(c)).replace(
        access,
        c.get('principal'),
        member,
        c.req.valid('json'),
      );
      return ok(c, result, { message: 'Contacts saved' });
    },
  )

  // ---- Records (US-026 – US-028, US-030) ----------------------------------------------
  .get(
    '/:memberId/:kind',
    signedIn,
    validate('param', recordPathParam),
    validate('query', recordListQuerySchema),
    async (c) => {
      const params = c.req.valid('param');
      const kind = kindOf(params.kind);
      const { access, member } = await memberFor(c, params.memberId);
      const result = await new RecordService(contextOf(c)).list(
        tenantOf(c),
        access,
        member,
        kind,
        c.req.valid('query').include === 'history',
      );
      return ok(c, result);
    },
  )
  .post('/:memberId/:kind', signedIn, validate('param', recordPathParam), async (c) => {
    const params = c.req.valid('param');
    const kind = kindOf(params.kind);
    const { access, member } = await memberFor(c, params.memberId);
    const { input, file } = await recordForm(c, kind);
    const dto = await new RecordService(contextOf(c)).create(
      tenantOf(c),
      access,
      c.get('principal'),
      member,
      kind,
      input,
      file,
    );
    return created(c, dto, { message: 'Record added' });
  })
  .get('/:memberId/:kind/:recordId', signedIn, validate('param', recordParam), async (c) => {
    const params = c.req.valid('param');
    const kind = kindOf(params.kind);
    const { access, member } = await memberFor(c, params.memberId);
    const dto = await new RecordService(contextOf(c)).detail(
      tenantOf(c),
      access,
      c.get('principal'),
      member,
      kind,
      params.recordId,
    );
    return ok(c, dto);
  })
  .patch('/:memberId/:kind/:recordId', signedIn, validate('param', recordParam), async (c) => {
    const params = c.req.valid('param');
    const kind = kindOf(params.kind);
    const { access, member } = await memberFor(c, params.memberId);
    const { input, file, removeFile } = await recordForm(c, kind);
    const dto = await new RecordService(contextOf(c)).update(
      tenantOf(c),
      access,
      c.get('principal'),
      member,
      kind,
      params.recordId,
      input,
      file,
      removeFile,
    );
    return ok(c, dto, { message: 'Record saved' });
  })
  .post('/:memberId/:kind/:recordId/renew', signedIn, validate('param', recordParam), async (c) => {
    const params = c.req.valid('param');
    const kind = kindOf(params.kind);
    const { access, member } = await memberFor(c, params.memberId);
    const { input, file } = await recordForm(c, kind);
    const dto = await new RecordService(contextOf(c)).renew(
      tenantOf(c),
      access,
      c.get('principal'),
      member,
      kind,
      params.recordId,
      input,
      file,
    );
    return created(c, dto, { message: 'Record renewed' });
  })
  .post(
    '/:memberId/:kind/:recordId/void',
    signedIn,
    validate('param', recordParam),
    validate('json', voidRecordRequestSchema),
    async (c) => {
      const params = c.req.valid('param');
      const kind = kindOf(params.kind);
      const { access, member } = await memberFor(c, params.memberId);
      await new RecordService(contextOf(c)).void(
        tenantOf(c),
        access,
        c.get('principal'),
        member,
        kind,
        params.recordId,
        c.req.valid('json').reason,
      );
      return c.body(null, 204);
    },
  )
  .get('/:memberId/:kind/:recordId/file', signedIn, validate('param', recordParam), async (c) => {
    const params = c.req.valid('param');
    const kind = kindOf(params.kind);
    const { access, member } = await memberFor(c, params.memberId);
    const opened = await new RecordService(contextOf(c)).openFile(
      tenantOf(c),
      access,
      c.get('principal'),
      member,
      kind,
      params.recordId,
    );
    return serve(c, opened, c.req.query('download') === 'true' ? 'attachment' : 'inline');
  });

/** `/api/v1/me/workforce` — O-85: the caller's own linked profile, read-only. */
export const workforceMeRoutes = new Hono<AppEnv>().get('/workforce', signedIn, async (c) => {
  const access = await accessOf(c);
  if (!access.ownMemberId) throw new NotFoundError();
  const member = await new MemberService(contextOf(c)).get(tenantOf(c), access, access.ownMemberId);
  return ok(c, { member });
});

/** `/api/v1/projects/{id}/workforce` — US-025. */
export const projectWorkforceRoutes = new Hono<AppEnv>()
  .get(
    '/:id/workforce',
    signedIn,
    requireProjectPermission('projects.workforce.view'),
    validate('query', projectWorkforceQuerySchema),
    async (c) => {
      const project = currentProject(c);
      const tenant = tenantOf(c);
      const granted = await permissionResolverFor(c).projectPermissions(
        c.get('principal').userId,
        tenant.id,
        project.id,
      );
      const query = c.req.valid('query');
      const result = await new AssignmentService(contextOf(c)).list(
        tenant,
        project,
        await accessOf(c),
        { manage: granted.has('projects.workforce.manage') },
        {
          state: query.state,
          attention: query.attention,
          page: query.page,
          ...(query.search ? { search: query.search } : {}),
          ...(query.position ? { position: query.position } : {}),
        },
      );
      return ok(c, result);
    },
  )
  .get(
    '/:id/workforce/candidates',
    signedIn,
    requireProjectPermission('projects.workforce.manage'),
    validate('query', workforceCandidatesQuerySchema),
    async (c) =>
      ok(
        c,
        await new AssignmentService(contextOf(c)).candidates(
          tenantOf(c),
          currentProject(c),
          await accessOf(c),
          c.req.valid('query').search,
        ),
      ),
  )
  .post(
    '/:id/workforce',
    signedIn,
    requireProjectPermission('projects.workforce.manage'),
    validate('json', assignWorkforceRequestSchema),
    async (c) => {
      const count = await new AssignmentService(contextOf(c)).assign(
        tenantOf(c),
        currentProject(c),
        c.get('principal'),
        c.req.valid('json'),
      );
      return created(c, { created: count }, { message: 'People assigned' });
    },
  )
  .patch(
    '/:id/workforce/:assignmentId',
    signedIn,
    requireProjectPermission('projects.workforce.manage'),
    validate('param', assignmentParam),
    validate('json', updateAssignmentRequestSchema),
    async (c) => {
      await new AssignmentService(contextOf(c)).update(
        tenantOf(c),
        currentProject(c),
        c.get('principal'),
        c.req.valid('param').assignmentId,
        c.req.valid('json'),
      );
      return c.body(null, 204);
    },
  )
  .post(
    '/:id/workforce/:assignmentId/end',
    signedIn,
    requireProjectPermission('projects.workforce.manage'),
    validate('param', assignmentParam),
    validate('json', endAssignmentRequestSchema),
    async (c) => {
      await new AssignmentService(contextOf(c)).end(
        tenantOf(c),
        currentProject(c),
        c.get('principal'),
        c.req.valid('param').assignmentId,
        c.req.valid('json').endDate,
      );
      return c.body(null, 204);
    },
  )
  .post(
    '/:id/workforce/:assignmentId/cancel',
    signedIn,
    requireProjectPermission('projects.workforce.manage'),
    validate('param', assignmentParam),
    async (c) => {
      await new AssignmentService(contextOf(c)).cancel(
        tenantOf(c),
        currentProject(c),
        c.get('principal'),
        c.req.valid('param').assignmentId,
      );
      return c.body(null, 204);
    },
  );
