import {
  type NotificationDto,
  notificationListQuerySchema,
  type NotificationOpenDto,
  type NotificationPageDto,
  type NotificationParams,
  type NotificationType,
} from '@hse/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import { NotFoundError } from '../../core/errors/app-error';
import { ok } from '../../core/http/response';
import { validate } from '../../core/http/validation';
import { createDatabase } from '../../database/client';
import {
  NotificationService,
  parseCursor,
  type NotificationRow,
} from '../../platform/notification';
import { permissionResolverFor, userNames, validateIdentitySession } from '../identity';
import { ActionDirectory } from '../action';
import { ProjectDirectory } from '../project';

const signedIn = authenticate(validateIdentitySession);
const idParam = z.object({ id: z.uuid() });

function companyOf(c: Context<AppEnv>) {
  const tenant = c.get('tenant');
  if (tenant.kind !== 'company') throw new NotFoundError();
  return tenant.company;
}

function service(c: Context<AppEnv>): NotificationService {
  return new NotificationService(createDatabase(c.env.DB));
}

/**
 * PLT-17 FR-2: for each type, the permission the reader needs now to open the record, and
 * where it opens (T-41). `null` route = nothing to open (the notice is the whole message).
 */
type Target =
  | {
      kind: 'project';
      permission: 'projects.view' | 'projects.members.view' | 'projects.workforce.view';
      suffix: string;
    }
  /** PLT-20 digest: the project's Workforce tab when sent for one project, else the directory. */
  | { kind: 'workforce_digest' }
  /** Sprint 8: the action page, if the reader may still view the action (T-65). */
  | { kind: 'action' }
  /** PLT-24: My actions, due today and overdue. */
  | { kind: 'my_actions' }
  | {
      kind: 'company';
      permission: 'roles.view' | 'users.view' | 'subscription.view' | 'workforce.view' | null;
      route: (row: NotificationRow, params: NotificationParams) => string;
    }
  | { kind: 'none' };

const TARGETS: Record<NotificationType, Target> = {
  'project.member.added': { kind: 'project', permission: 'projects.view', suffix: '' },
  'project.member.joined': {
    kind: 'project',
    permission: 'projects.members.view',
    suffix: '/members',
  },
  'project.member.role_changed': { kind: 'project', permission: 'projects.view', suffix: '' },
  'project.member.removed': { kind: 'none' },
  'project.member.access_ending': { kind: 'project', permission: 'projects.view', suffix: '' },
  'project.status.changed': { kind: 'project', permission: 'projects.view', suffix: '' },
  'project.archived': { kind: 'project', permission: 'projects.view', suffix: '' },
  'project.restored': { kind: 'project', permission: 'projects.view', suffix: '' },
  'company.role.changed': { kind: 'company', permission: null, route: () => '/profile' },
  'role.permissions.changed': {
    kind: 'company',
    permission: 'roles.view',
    route: (_row, params) => `/settings/roles/${params.roleCode ?? ''}`,
  },
  'user.locked': {
    kind: 'company',
    permission: 'users.view',
    route: (row) => `/settings/users/${row.entityId ?? ''}`,
  },
  'subscription.reminder': {
    kind: 'company',
    permission: 'subscription.view',
    route: () => '/settings/subscription',
  },
  // Sprint 7
  'workforce.attention.digest': { kind: 'workforce_digest' },
  'workforce.record.expiring': { kind: 'company', permission: null, route: () => '/me/workforce' },
  'workforce.assignment.added': { kind: 'company', permission: null, route: () => '/me/workforce' },
  'workforce.member.suspended': {
    kind: 'project',
    permission: 'projects.workforce.view',
    suffix: '/workforce',
  },
  // Sprint 8
  'action.assigned': { kind: 'action' },
  'action.unassigned': { kind: 'action' },
  'action.collaborator_added': { kind: 'action' },
  'action.due_tomorrow': { kind: 'action' },
  'action.overdue': { kind: 'action' },
  'action.due_digest': { kind: 'my_actions' },
  'action.verification_needed': { kind: 'action' },
  'action.sent_back': { kind: 'action' },
  'action.verified': { kind: 'action' },
  'action.closed': { kind: 'action' },
  'action.voided': { kind: 'action' },
  'action.due_date_changed': { kind: 'action' },
  'action.comment_added': { kind: 'action' },
  'action.owner_lost_access': { kind: 'action' },
  // Sprint 9 (O-131): the conflict review screen; it answers 404 once the conflict is gone.
  'sync.conflict': {
    kind: 'company',
    permission: null,
    route: (row) => `/sync/conflicts/${row.entityId ?? ''}`,
  },
};

async function openTarget(c: Context<AppEnv>, row: NotificationRow): Promise<NotificationOpenDto> {
  const target = TARGETS[row.type];
  const company = companyOf(c);
  const userId = c.get('principal').userId;
  const resolver = permissionResolverFor(c);
  switch (target.kind) {
    case 'none':
      return { route: null, access: true };
    case 'my_actions':
      return { route: '/my-actions?due=overdue,due_today', access: true };
    case 'action': {
      if (!row.entityId) return { route: null, access: false };
      const projectId = await new ActionDirectory(createDatabase(c.env.DB), resolver).viewableProject(
        c.get('principal'),
        company.id,
        row.entityId,
      );
      return projectId
        ? { route: `/projects/${projectId}/actions/${row.entityId}`, access: true }
        : { route: null, access: false };
    }
    case 'workforce_digest': {
      if (row.projectId) {
        const granted = await resolver.projectPermissions(userId, company.id, row.projectId);
        return granted.has('projects.workforce.view')
          ? { route: `/projects/${row.projectId}/workforce?attention=true`, access: true }
          : { route: null, access: false };
      }
      const granted = await resolver.companyPermissions(userId, company.id);
      return granted.has('workforce.view')
        ? { route: '/workforce?attention=true', access: true }
        : { route: null, access: false };
    }
    case 'project': {
      if (!row.projectId) return { route: null, access: false };
      const project = await new ProjectDirectory(createDatabase(c.env.DB)).get(
        company.id,
        row.projectId,
      );
      if (!project) return { route: null, access: false };
      const granted = await resolver.projectPermissions(userId, company.id, project.id);
      return granted.has(target.permission)
        ? { route: `/projects/${project.id}${target.suffix}`, access: true }
        : { route: null, access: false };
    }
    case 'company': {
      if (target.permission) {
        const granted = await resolver.companyPermissions(userId, company.id);
        if (!granted.has(target.permission)) return { route: null, access: false };
      }
      const params = JSON.parse(row.params) as NotificationParams;
      return { route: target.route(row, params), access: true };
    }
  }
}

/** `/api/v1/notifications` — PLT-17. Only the signed-in user's own notifications. */
export const notificationRoutes = new Hono<AppEnv>()
  .get('/', signedIn, validate('query', notificationListQuerySchema), async (c) => {
    const { unread, before, limit } = c.req.valid('query');
    const db = createDatabase(c.env.DB);
    const { rows, next } = await new NotificationService(db).list(
      c.get('principal').userId,
      companyOf(c).id,
      { unread, before: parseCursor(before), limit },
    );
    const names = await userNames(
      db,
      rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])),
    );
    const body: NotificationPageDto = {
      nextBefore: next,
      items: rows.map((row): NotificationDto => ({
        id: row.id,
        type: row.type,
        params: JSON.parse(row.params) as NotificationParams,
        actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
        projectId: row.projectId,
        createdAt: row.createdAt.getTime(),
        readAt: row.readAt?.getTime() ?? null,
      })),
    };
    return ok(c, body);
  })
  .get('/unread-count', signedIn, async (c) =>
    ok(c, {
      count: await service(c).unreadCount(c.get('principal').userId, companyOf(c).id),
    }),
  )
  .post('/read-all', signedIn, async (c) =>
    ok(c, {
      marked: await service(c).markAllRead(c.get('principal').userId, companyOf(c).id),
    }),
  )
  .post('/:id/read', signedIn, validate('param', idParam), async (c) => {
    const notifications = service(c);
    const userId = c.get('principal').userId;
    const companyId = companyOf(c).id;
    const { id } = c.req.valid('param');
    if (!(await notifications.find(userId, companyId, id))) throw new NotFoundError();
    await notifications.markRead(userId, companyId, id);
    return c.body(null, 204);
  })
  .get('/:id/open', signedIn, validate('param', idParam), async (c) => {
    const notifications = service(c);
    const userId = c.get('principal').userId;
    const companyId = companyOf(c).id;
    const row = await notifications.find(userId, companyId, c.req.valid('param').id);
    if (!row) throw new NotFoundError();
    await notifications.markRead(userId, companyId, row.id);
    return ok(c, await openTarget(c, row));
  });
