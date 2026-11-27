import type { OfflinePackDto, OfflineProfileDto } from '@hse/shared';
import { Hono } from 'hono';

import { authenticate } from '../../core/auth/authenticate.middleware';
import type { AppEnv } from '../../core/context/app-context';
import { requestMeta } from '../../core/http/request-meta';
import { ok } from '../../core/http/response';
import { sha256Hex } from '../../core/security/secure-token';
import { createDatabase } from '../../database/client';
import { permissionResolverFor, ProjectMembership, validateIdentitySession } from '../identity';
import { PlaceService } from './place.service';
import { currentProject, requireProjectPermission, tenantCompany } from './project-permission';
import { ProjectRepository } from './project.repository';

const signedIn = authenticate(validateIdentitySession);
/** Same limit as the switcher: the projects a user works on, not the whole company. */
const PROFILE_PROJECTS_MAX = 100;

/** `/api/v1/me/offline-profile` — PLT-27 (T-73). The device stores it with `/auth/me`. */
export const offlineProfileRoutes = new Hono<AppEnv>().get('/offline-profile', signedIn, async (c) => {
  const company = tenantCompany(c);
  const userId = c.get('principal').userId;
  const resolver = permissionResolverFor(c);
  const access = await resolver.projectAccess(userId, company.id, 'projects.view');
  const rows = await new ProjectRepository(createDatabase(c.env.DB)).listForSwitcher(company.id, {
    projectIds: access.allProjects ? null : access.projectIds,
    limit: PROFILE_PROJECTS_MAX,
  });
  const projects = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      permissions: [...(await resolver.projectPermissions(userId, company.id, row.id))].sort(),
    })),
  );
  const subscription = c.get('tenantSubscription');
  const body: OfflineProfileDto = {
    company: {
      slug: company.slug,
      name: company.name,
      timeZone: company.timeZone,
      readOnly: company.readOnly || Boolean(subscription?.readOnlySince),
    },
    projects,
    generatedAt: Date.now(),
  };
  return ok(c, body);
});

/** `/api/v1/projects/{id}/offline-pack` — PLT-26: places and members for offline pickers. */
export const offlinePackRoutes = new Hono<AppEnv>().get(
  '/:id/offline-pack',
  signedIn,
  requireProjectPermission('projects.view'),
  async (c) => {
    const project = currentProject(c);
    const db = createDatabase(c.env.DB);
    const [places, members] = await Promise.all([
      new PlaceService({ db, meta: requestMeta(c), clock: Date.now }).tree(project, false),
      new ProjectMembership(db).view(project.companyId, project.id, tenantCompany(c).timeZone),
    ]);
    const people = new Map<string, string>();
    for (const row of members.team) {
      if (row.state !== 'ended' && row.user.status === 'active') people.set(row.user.id, row.user.fullName);
    }
    for (const row of members.companyWide) people.set(row.user.id, row.user.fullName);
    const content = {
      project: { id: project.id, code: project.code, name: project.name, status: project.status },
      places,
      members: [...people]
        .map(([id, fullName]) => ({ id, fullName }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    };
    // The ETag covers the content only, so an unchanged pack answers 304 (PLT-26 FR-4).
    const etag = `"${(await sha256Hex(JSON.stringify(content))).slice(0, 32)}"`;
    const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' };
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
    const body: OfflinePackDto = { ...content, generatedAt: Date.now() };
    for (const [name, value] of Object.entries(headers)) c.header(name, value);
    return ok(c, body);
  },
);
