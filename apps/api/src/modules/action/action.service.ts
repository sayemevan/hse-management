import {
  ACTION_LIMITS,
  ACTIVITY_ACTIONS,
  type ActionCandidateDto,
  type ActionDto,
  actionListQuerySchema,
  type ActionPageDto,
  actionReference,
  type ActionStatus,
  type ActionSummaryDto,
  type ActivityEntryDto,
  type AddCollaboratorsRequest,
  addIsoDays,
  type ChangeOwnerRequest,
  COMMENT_LIMITS,
  type CommentDto,
  type CommentPageDto,
  COMPANY_WIDE_ROLES,
  createActionRequestSchema,
  EVIDENCE_REQUIRED_PRIORITIES,
  generateId,
  isActionActive,
  type MyActionsPageDto,
  type MyActionsSummaryDto,
  myActionsQuerySchema,
  normalizeSearchText,
  type NotificationParams,
  type NotificationType,
  type ProgressRequest,
  type TimelinePageDto,
  type TransitionRequest,
  type UpdateActionRequest,
  workflowStep,
} from '@hse/shared';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../../core/errors/app-error';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { changedFields, parseActivityCursor } from '../../platform/activity';
import { type CommentTarget, parseCommentCursor } from '../../platform/comment';
import type { OpenedFile } from '../../platform/file-storage';
import { userSummaries } from '../identity';
import { ProjectArchivedError, ProjectDirectory, type ProjectRow, type ResolvedPlace } from '../project';
import { type ActionContext } from './action-context';
import {
  type ActionViewer,
  canOf,
  factsOf,
  locked,
  mayView,
  transitionsFor,
  viewAll,
} from './action-access';
import { ActionEngine } from './action-engine';
import {
  ActionLockedError,
  CollaboratorLimitError,
  DueDateInvalidError,
  EvidenceRequiredError,
  FileLimitError,
  OwnerNotEligibleError,
  ReasonRequiredError,
  TransitionNotAllowedError,
  VerifierIsParticipantError,
} from './action.errors';
import type { ActionFilters, ListScope } from './action.repository';
import type { ActionRow, ActionUpdateRow } from './action.schema';
import {
  deepestPlaceId,
  type PeopleIndex,
  person,
  toFile,
  toListItem,
  toUpdate,
} from './action-views';

type ListQuery = z.output<typeof actionListQuerySchema>;
type MineQuery = z.output<typeof myActionsQuerySchema>;
type CreateInput = z.output<typeof createActionRequestSchema>;

/** A loaded action with what the caller is to it. */
interface Loaded {
  row: ActionRow;
  collaboratorIds: string[];
  viewer: ActionViewer;
}

/** The SQLite error raised by the status guard (T-58: someone moved the action first). */
const GUARD_MESSAGE = 'malformed JSON';

/** US-053 – US-058 and PLT-24 on one project (T-45: the project comes from the URL). */
export class ActionService {
  private readonly engine: ActionEngine;

  constructor(private readonly ctx: ActionContext) {
    this.engine = new ActionEngine(ctx);
  }

  // ---- Loading and access ---------------------------------------------------------------

  async viewer(tenant: TenantCompany, project: ProjectRow, principal: Principal): Promise<ActionViewer> {
    return {
      userId: principal.userId,
      granted: await this.ctx.resolver.projectPermissions(principal.userId, tenant.id, project.id),
      archived: project.status === 'archived',
    };
  }

  /** T-65: an action the caller can't see doesn't exist for them (`404`). */
  async load(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
  ): Promise<Loaded> {
    const row = await this.ctx.repo.find(tenant.id, project.id, actionId);
    if (!row) throw new NotFoundError();
    const collaboratorIds = (await this.ctx.repo.collaboratorsOf([row.id])).map((c) => c.userId);
    const viewer = await this.viewer(tenant, project, principal);
    if (!(await mayView(this.ctx.db, principal, viewer, row, collaboratorIds))) {
      throw new NotFoundError();
    }
    return { row, collaboratorIds, viewer };
  }

  private assertWritable(loaded: Loaded): void {
    if (loaded.viewer.archived) throw new ProjectArchivedError();
    if (locked(loaded.row)) throw new ActionLockedError();
  }

  private assertActive(loaded: Loaded): void {
    this.assertWritable(loaded);
    if (!isActionActive(loaded.row.status)) throw new TransitionNotAllowedError(loaded.row.status);
  }

  private requireManage(loaded: Loaded): void {
    if (!loaded.viewer.granted.has('projects.actions.manage')) throw new ForbiddenError();
  }

  // ---- Reading --------------------------------------------------------------------------

  async detail(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
  ): Promise<ActionDto> {
    return this.toDetail(tenant, project, await this.load(tenant, project, principal, actionId));
  }

  private async toDetail(tenant: TenantCompany, project: ProjectRow, loaded: Loaded): Promise<ActionDto> {
    const { row, collaboratorIds, viewer } = loaded;
    const [updates, files, history, followUps, sentBack] = await Promise.all([
      this.ctx.repo.updates(row.id),
      this.ctx.repo.files(row.id),
      this.ctx.repo.ownerHistory(row.id),
      this.ctx.repo.followUps(tenant.id, row.id),
      row.status === 'in_progress' && row.sendBackCount > 0
        ? this.ctx.repo.latestSendBack(row.id)
        : Promise.resolve(null),
    ]);
    const ids = [
      row.ownerId,
      row.createdBy,
      ...collaboratorIds,
      ...updates.map((u) => u.createdBy),
      ...history.map((h) => h.ownerId),
      ...(row.verifiedBy ? [row.verifiedBy] : []),
      ...(row.closedBy ? [row.closedBy] : []),
    ];
    const people = await this.people(tenant.id, project.id, ids, [row.ownerId, ...collaboratorIds]);
    const placeId = deepestPlaceId(row);
    const places = placeId
      ? await this.ctx.places.resolveMany(tenant.id, project.id, [placeId])
      : new Map<string, ResolvedPlace>();
    const visibleFollowUps = viewAll(viewer)
      ? followUps
      : followUps.filter((f) => f.ownerId === viewer.userId || f.createdBy === viewer.userId);
    return {
      ...toListItem(row, { projectCode: project.code, today: this.ctx.today(tenant), people, places }),
      description: row.description,
      createdBy: person(people, row.createdBy),
      createdAt: row.createdAt.getTime(),
      collaborators: collaboratorIds.map((id) => person(people, id)),
      startedAt: row.startedAt?.getTime() ?? null,
      completedAt: row.completedAt?.getTime() ?? null,
      completedOnTime: row.completedOnTime,
      verifiedAt: row.verifiedAt?.getTime() ?? null,
      verifiedBy: row.verifiedBy ? person(people, row.verifiedBy) : null,
      verificationMethod: row.verificationMethod,
      closedAt: row.closedAt?.getTime() ?? null,
      closedBy: row.closedBy ? person(people, row.closedBy) : null,
      sendBackCount: row.sendBackCount,
      sentBackReason: sentBack,
      voidedAt: row.voidedAt?.getTime() ?? null,
      voidReason: row.voidReason,
      followUps: visibleFollowUps.map((f) => ({
        id: f.id,
        reference: actionReference(project.code, f.number),
        status: f.status,
      })),
      updates: updates.map((u) => toUpdate(u, people)),
      files: files.map((f) => toFile(f, updates)),
      ownerHistory: history.map((h) => ({
        owner: person(people, h.ownerId),
        fromAt: h.fromAt.getTime(),
        toAt: h.toAt?.getTime() ?? null,
        assignedBy: h.assignedBy ? (people.names.get(h.assignedBy) ?? null) : null,
        reason: h.reason,
      })),
      allowedTransitions: transitionsFor(viewer, row, collaboratorIds),
      can: canOf(viewer, row, collaboratorIds, project.status === 'mobilization' || project.status === 'active'),
    };
  }

  /** Names for `ids`; project access (O-101) for `checkAccess`. */
  private async people(
    companyId: string,
    projectId: string,
    ids: readonly string[],
    checkAccess: readonly string[],
  ): Promise<PeopleIndex> {
    const summaries = await userSummaries(this.ctx.db, [...new Set(ids)]);
    const names = new Map([...summaries].map(([id, s]) => [id, s.fullName]));
    const access = new Map<string, boolean>();
    for (const id of new Set(checkAccess)) {
      access.set(id, await this.ctx.eligible(companyId, projectId, id));
    }
    return { names, access };
  }

  // ---- Lists (PLT-24) -------------------------------------------------------------------

  async list(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    query: ListQuery,
  ): Promise<ActionPageDto> {
    const viewer = await this.viewer(tenant, project, principal);
    const scope: ListScope = viewAll(viewer) ? { all: true } : { all: false, userId: viewer.userId };
    const today = this.ctx.today(tenant);
    const filters: ActionFilters = {
      statuses: query.status,
      due: query.due,
      priorities: query.priority,
      types: query.type,
      ownerId: query.owner,
      placeId: query.place,
      source: query.source,
      voided: query.voided,
      search: query.search,
    };
    if (query.noAccess) {
      const owners = await this.ctx.repo.ownersOf(project.id);
      const without: string[] = [];
      for (const id of owners) if (!(await this.ctx.eligible(tenant.id, project.id, id))) without.push(id);
      if (without.length === 0) return { items: [], nextCursor: null };
      filters.ownerIds = without;
    }
    const { rows, next } = await this.ctx.repo.listForProject(
      tenant.id,
      project.id,
      scope,
      filters,
      today,
      query.cursor,
    );
    return { items: await this.items(tenant, rows, today), nextCursor: next };
  }

  /** List items of rows from one or more projects. */
  private async items(tenant: TenantCompany, rows: readonly ActionRow[], today: string) {
    const projects = await new ProjectDirectory(this.ctx.db).getMany(
      tenant.id,
      [...new Set(rows.map((r) => r.projectId))],
    );
    const summaries = await userSummaries(this.ctx.db, [...new Set(rows.map((r) => r.ownerId))]);
    const names = new Map([...summaries].map(([id, s]) => [id, s.fullName]));
    const access = new Map<string, boolean>();
    const placesByProject = new Map<string, Map<string, ResolvedPlace>>();
    for (const projectId of projects.keys()) {
      const projectRows = rows.filter((r) => r.projectId === projectId);
      placesByProject.set(
        projectId,
        await this.ctx.places.resolveMany(
          tenant.id,
          projectId,
          projectRows.flatMap((r) => {
            const id = deepestPlaceId(r);
            return id ? [id] : [];
          }),
        ),
      );
    }
    const items = [];
    for (const row of rows) {
      const key = `${row.projectId}:${row.ownerId}`;
      if (!access.has(key)) {
        access.set(key, await this.ctx.eligible(tenant.id, row.projectId, row.ownerId));
      }
      items.push(
        toListItem(row, {
          projectCode: projects.get(row.projectId)?.code ?? '',
          today,
          people: { names, access: new Map([[row.ownerId, access.get(key) ?? true]]) },
          places: placesByProject.get(row.projectId) ?? new Map(),
        }),
      );
    }
    return items;
  }

  async summary(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
  ): Promise<ActionSummaryDto> {
    const viewer = await this.viewer(tenant, project, principal);
    const scope: ListScope = viewAll(viewer) ? { all: true } : { all: false, userId: viewer.userId };
    return this.ctx.repo.summary(
      tenant.id,
      project.id,
      scope,
      this.ctx.today(tenant),
      viewer.granted.has('projects.actions.verify') ? viewer.userId : null,
    );
  }

  private async myScopes(tenant: TenantCompany, userId: string) {
    const [view, verify] = await Promise.all([
      this.ctx.resolver.projectAccess(userId, tenant.id, 'projects.view'),
      this.ctx.resolver.projectAccess(userId, tenant.id, 'projects.actions.verify'),
    ]);
    return {
      projectIds: view.allProjects ? null : view.projectIds,
      verifyProjectIds: verify.allProjects ? null : verify.projectIds,
    };
  }

  async mine(tenant: TenantCompany, principal: Principal, query: MineQuery): Promise<MyActionsPageDto> {
    const today = this.ctx.today(tenant);
    const scopes = await this.myScopes(tenant, principal.userId);
    const common = { ...scopes, today, due: [] as const, offset: 0, limit: 0 };
    const [page, owned, collaborating, verify] = await Promise.all([
      this.ctx.repo.listMine(tenant.id, principal.userId, query.tab, {
        ...scopes,
        today,
        due: query.due,
        offset: query.cursor,
      }),
      this.ctx.repo.listMine(tenant.id, principal.userId, 'owned', common),
      this.ctx.repo.listMine(tenant.id, principal.userId, 'collaborating', common),
      this.ctx.repo.listMine(tenant.id, principal.userId, 'verify', common),
    ]);
    return {
      items: await this.items(tenant, page.rows, today),
      nextCursor: page.next,
      counts: { owned: owned.total, collaborating: collaborating.total, verify: verify.total },
    };
  }

  async mineSummary(tenant: TenantCompany, principal: Principal): Promise<MyActionsSummaryDto> {
    const today = this.ctx.today(tenant);
    const scopes = await this.myScopes(tenant, principal.userId);
    const base = { ...scopes, today, offset: 0, limit: 0 };
    const [overdue, dueToday, verify] = await Promise.all([
      this.ctx.repo.listMine(tenant.id, principal.userId, 'owned', { ...base, due: ['overdue'] }),
      this.ctx.repo.listMine(tenant.id, principal.userId, 'owned', { ...base, due: ['due_today'] }),
      this.ctx.repo.listMine(tenant.id, principal.userId, 'verify', { ...base, due: [] }),
    ]);
    return { overdue: overdue.total, dueToday: dueToday.total, toVerify: verify.total };
  }

  /** US-053 FR-8: active users who can view the project, 20 at a time. */
  async candidates(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    search: string | undefined,
  ): Promise<{ users: ActionCandidateDto[] }> {
    const viewer = await this.viewer(tenant, project, principal);
    if (
      !viewer.granted.has('projects.actions.create') &&
      !viewer.granted.has('projects.actions.manage')
    ) {
      // Owners manage their collaborators (O-102); they may search too.
      const owns = await this.ctx.repo.listMine(tenant.id, principal.userId, 'owned', {
        projectIds: [project.id],
        verifyProjectIds: [],
        due: [],
        today: this.ctx.today(tenant),
        offset: 0,
        limit: 0,
      });
      if (owns.total === 0) throw new ForbiddenError();
    }
    const [projectRoles, wide] = await Promise.all([
      this.ctx.audience.projectRoles(tenant.id, project.id),
      Promise.all(
        COMPANY_WIDE_ROLES.map(async (role) => ({
          role,
          users: await this.ctx.audience.companyRoleHolders(tenant.id, [role]),
        })),
      ),
    ]);
    const roleOf = new Map<string, { roleCode: string; companyWide: boolean }>();
    for (const entry of wide) {
      for (const userId of entry.users) roleOf.set(userId, { roleCode: entry.role, companyWide: true });
    }
    for (const row of projectRoles) {
      if (!roleOf.has(row.userId)) roleOf.set(row.userId, { roleCode: row.roleCode, companyWide: false });
    }
    const summaries = await userSummaries(this.ctx.db, [...roleOf.keys()]);
    const needle = search ? normalizeSearchText(search) : null;
    const users: ActionCandidateDto[] = [];
    for (const [userId, role] of roleOf) {
      const summary = summaries.get(userId);
      if (!summary || summary.former || summary.companyId !== tenant.id) continue;
      if (needle && !normalizeSearchText(`${summary.fullName} ${summary.email}`).includes(needle)) {
        continue;
      }
      if (!(await this.ctx.eligible(tenant.id, project.id, userId))) continue;
      users.push({ id: userId, name: summary.fullName, ...role });
    }
    users.sort((a, b) =>
      a.id === principal.userId ? -1 : b.id === principal.userId ? 1 : a.name.localeCompare(b.name),
    );
    return { users: users.slice(0, 20) };
  }

  async history(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    before: string | undefined,
  ): Promise<TimelinePageDto> {
    const { row } = await this.load(tenant, project, principal, actionId);
    const { rows, next } = await this.ctx.activity.listForEntity(
      tenant.id,
      { type: 'action', id: row.id },
      { before: parseActivityCursor(before), limit: 50 },
    );
    const actors = await userSummaries(
      this.ctx.db,
      rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])),
    );
    return {
      nextBefore: next,
      items: rows.map((entry): ActivityEntryDto => {
        const actor = entry.actorUserId ? actors.get(entry.actorUserId) : undefined;
        const name = entry.action as ActivityEntryDto['action'];
        return {
          id: entry.id,
          action: name,
          group: ACTIVITY_ACTIONS[name],
          actorName: actor?.fullName ?? null,
          actorFormer: actor ? actor.former || actor.companyId !== tenant.id : false,
          occurredAt: entry.occurredAt.getTime(),
          changes: entry.changes ? (JSON.parse(entry.changes) as ActivityEntryDto['changes']) : null,
          snapshot: entry.snapshot ? (JSON.parse(entry.snapshot) as ActivityEntryDto['snapshot']) : {},
        };
      }),
    };
  }

  // ---- Create and edit (US-053) ---------------------------------------------------------

  async create(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    input: CreateInput,
  ): Promise<ActionDto> {
    const viewer = await this.viewer(tenant, project, principal);
    if (!viewer.granted.has('projects.actions.create')) throw new ForbiddenError();
    const prepared = await this.engine.create({
      tenant,
      project,
      source: input.followUpOf
        ? { module: 'action', recordId: input.followUpOf }
        : { module: 'manual' },
      type: input.type,
      priority: input.priority,
      title: input.title,
      description: input.description ?? null,
      ownerId: input.ownerId,
      dueOn: input.dueOn,
      place: input.place ?? null,
      collaboratorIds: input.collaboratorIds ?? [],
      createdBy: principal.userId,
    });
    return this.detail(tenant, project, principal, prepared.row.id);
  }

  async update(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    input: UpdateActionRequest,
  ): Promise<ActionDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    this.requireManage(loaded);
    this.assertActive(loaded);
    const { row } = loaded;

    const next = {
      title: input.title ?? row.title,
      type: input.type ?? row.type,
      priority: input.priority ?? row.priority,
      dueOn: input.dueOn ?? row.dueOn,
      description: input.description === undefined ? row.description : input.description,
      areaId: row.areaId,
      locationId: row.locationId,
      workZoneId: row.workZoneId,
    };
    if (input.place !== undefined) {
      const place = input.place ?? {};
      const issues = await this.ctx.places.validateSelection(tenant.id, project.id, place, {
        allowInactiveIds: [row.areaId, row.locationId, row.workZoneId].flatMap((id) => (id ? [id] : [])),
      });
      if (issues.length > 0) {
        throw new ValidationError(issues.map((issue) => ({ ...issue, path: `place.${issue.path}` })));
      }
      next.areaId = place.areaId ?? null;
      next.locationId = place.locationId ?? null;
      next.workZoneId = place.workZoneId ?? null;
    }
    const dueChanged = next.dueOn !== row.dueOn;
    const priorityChanged = next.priority !== row.priority;
    const reason = input.reason?.trim() ?? '';
    if ((dueChanged || priorityChanged) && reason.length < ACTION_LIMITS.changeReasonMin) {
      throw new ReasonRequiredError();
    }
    if (dueChanged) {
      const today = this.ctx.today(tenant);
      if (next.dueOn < today || next.dueOn > addIsoDays(today, ACTION_LIMITS.dueDaysMax)) {
        throw new DueDateInvalidError();
      }
    }
    const before = {
      title: row.title,
      type: row.type,
      priority: row.priority,
      dueOn: row.dueOn,
      description: row.description,
      areaId: row.areaId,
      locationId: row.locationId,
      workZoneId: row.workZoneId,
    };
    const changes = changedFields(before, next);
    if (!changes) return this.toDetail(tenant, project, loaded);

    const now = new Date(this.ctx.now());
    const updated: ActionRow = {
      ...row,
      ...next,
      searchKey: normalizeSearchText(next.title),
      updatedAt: now,
      updatedBy: principal.userId,
    };
    const statements: Statement[] = [
      this.ctx.repo.updateIf(row.id, ['open', 'in_progress'], {
        ...next,
        searchKey: updated.searchKey,
        updatedAt: now,
        updatedBy: principal.userId,
      }),
      this.guard(row.id, { updatedAt: now }),
      ...this.ctx.record(principal.userId, updated, project.code, {
        audit: 'action.updated',
        activity: 'action.updated',
        oldValue: changes.before,
        newValue: { ...changes.after, ...(reason ? { reason } : {}) },
        changes,
        snapshot: reason ? { reason: reason.slice(0, 200) } : {},
      }),
    ];
    if (dueChanged) {
      statements.push(
        ...(await this.notify('action.due_date_changed', updated, project, principal.userId, [
          updated.ownerId,
          ...loaded.collaboratorIds,
        ])),
      );
    }
    await this.commit(row, statements);
    return this.detail(tenant, project, principal, row.id);
  }

  // ---- Owner and collaborators (US-054) -------------------------------------------------

  async changeOwner(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    input: ChangeOwnerRequest,
  ): Promise<ActionDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    this.requireManage(loaded);
    this.assertActive(loaded);
    const { row } = loaded;
    if (input.ownerId === row.ownerId) throw new OwnerNotEligibleError();
    if (!(await this.ctx.eligible(tenant.id, project.id, input.ownerId))) {
      throw new OwnerNotEligibleError();
    }
    const now = new Date(this.ctx.now());
    const updated: ActionRow = { ...row, ownerId: input.ownerId, updatedAt: now, updatedBy: principal.userId };
    const names = await userSummaries(this.ctx.db, [row.ownerId, input.ownerId]);
    const statements: Statement[] = [
      this.ctx.repo.updateIf(row.id, ['open', 'in_progress'], {
        ownerId: input.ownerId,
        updatedAt: now,
        updatedBy: principal.userId,
      }),
      this.guard(row.id, { updatedAt: now }),
      this.ctx.repo.closeOwnerHistory(row.id, now),
      this.ctx.repo.openOwnerHistory({
        id: generateId(),
        actionId: row.id,
        ownerId: input.ownerId,
        fromAt: now,
        assignedBy: principal.userId,
        reason: input.reason,
      }),
      ...(loaded.collaboratorIds.includes(input.ownerId)
        ? [this.ctx.repo.removeCollaborator(row.id, input.ownerId, now, principal.userId)]
        : []),
      ...this.ctx.record(principal.userId, updated, project.code, {
        audit: 'action.owner_changed',
        activity: 'action.owner_changed',
        oldValue: { ownerId: row.ownerId },
        newValue: { ownerId: input.ownerId, reason: input.reason },
        changes: {
          before: { owner: names.get(row.ownerId)?.fullName ?? null },
          after: { owner: names.get(input.ownerId)?.fullName ?? null },
        },
        snapshot: { reason: input.reason.slice(0, 200) },
      }),
      ...(await this.notify('action.assigned', updated, project, principal.userId, [input.ownerId])),
      ...(await this.notify('action.unassigned', updated, project, principal.userId, [row.ownerId])),
    ];
    await this.commit(row, statements);
    return this.detail(tenant, project, principal, row.id);
  }

  async addCollaborators(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    input: AddCollaboratorsRequest,
  ): Promise<ActionDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    const { row } = loaded;
    if (!loaded.viewer.granted.has('projects.actions.manage') && row.ownerId !== principal.userId) {
      throw new ForbiddenError();
    }
    this.assertActive(loaded);
    const added = [...new Set(input.userIds)].filter(
      (id) => id !== row.ownerId && !loaded.collaboratorIds.includes(id),
    );
    if (input.userIds.includes(row.ownerId)) throw new OwnerNotEligibleError();
    if (loaded.collaboratorIds.length + added.length > ACTION_LIMITS.collaboratorsMax) {
      throw new CollaboratorLimitError(ACTION_LIMITS.collaboratorsMax);
    }
    for (const userId of added) {
      if (!(await this.ctx.eligible(tenant.id, project.id, userId))) throw new OwnerNotEligibleError();
    }
    if (added.length === 0) return this.toDetail(tenant, project, loaded);
    const now = new Date(this.ctx.now());
    const names = await userSummaries(this.ctx.db, added);
    const statements: Statement[] = [];
    for (const userId of added) {
      statements.push(
        this.ctx.repo.addCollaborator({
          id: generateId(),
          actionId: row.id,
          userId,
          addedAt: now,
          addedBy: principal.userId,
          removedAt: null,
          removedBy: null,
        }),
        ...this.ctx.record(principal.userId, row, project.code, {
          audit: 'action.collaborator_added',
          activity: 'action.collaborator_added',
          newValue: { userId },
          snapshot: { memberName: names.get(userId)?.fullName ?? '' },
        }),
      );
    }
    statements.push(
      ...(await this.notify('action.collaborator_added', row, project, principal.userId, added)),
    );
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    return this.detail(tenant, project, principal, row.id);
  }

  async removeCollaborator(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    userId: string,
  ): Promise<void> {
    const loaded = await this.load(tenant, project, principal, actionId);
    const { row } = loaded;
    if (!loaded.viewer.granted.has('projects.actions.manage') && row.ownerId !== principal.userId) {
      throw new ForbiddenError();
    }
    this.assertActive(loaded);
    if (!loaded.collaboratorIds.includes(userId)) throw new NotFoundError();
    const now = new Date(this.ctx.now());
    const names = await userSummaries(this.ctx.db, [userId]);
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.repo.removeCollaborator(row.id, userId, now, principal.userId),
        ...this.ctx.record(principal.userId, row, project.code, {
          audit: 'action.collaborator_removed',
          activity: 'action.collaborator_removed',
          oldValue: { userId },
          snapshot: { memberName: names.get(userId)?.fullName ?? '' },
        }),
      )
      .commit();
  }

  // ---- Progress and files (US-055) ------------------------------------------------------

  async addProgress(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    input: ProgressRequest,
  ): Promise<ActionDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    this.assertActive(loaded);
    const { row } = loaded;
    const facts = factsOf(loaded.viewer, row, loaded.collaboratorIds);
    if (!facts.participant) throw new ForbiddenError();
    const fileIds = await this.ownFiles(row, input.fileIds ?? []);
    const now = new Date(this.ctx.now());
    const starts = facts.owner && row.status === 'open';
    const percent = input.percent ?? null;
    const updated: ActionRow = {
      ...row,
      status: starts ? 'in_progress' : row.status,
      startedAt: starts ? now : row.startedAt,
      progressPercent: percent ?? row.progressPercent,
      updatedAt: now,
      updatedBy: principal.userId,
    };
    const statements: Statement[] = [
      this.ctx.repo.updateIf(row.id, [row.status], {
        status: updated.status,
        startedAt: updated.startedAt,
        progressPercent: updated.progressPercent,
        updatedAt: now,
        updatedBy: principal.userId,
      }),
      this.guard(row.id, { updatedAt: now, status: updated.status }),
    ];
    if (starts) {
      statements.push(
        this.ctx.repo.insertUpdate(this.updateRow(row.id, 'start', principal.userId, now)),
        ...this.ctx.record(principal.userId, updated, project.code, {
          audit: 'action.started',
          activity: 'action.started',
          changes: { before: { status: row.status }, after: { status: 'in_progress' } },
        }),
      );
    }
    statements.push(
      this.ctx.repo.insertUpdate({
        ...this.updateRow(row.id, 'progress', principal.userId, new Date(now.getTime() + 1)),
        note: input.note,
        percent,
        fileIds: JSON.stringify(fileIds),
      }),
      ...this.ctx.record(principal.userId, updated, project.code, {
        audit: 'action.progress_added',
        activity: 'action.progress_added',
        at: now.getTime() + 1,
        newValue: { percent, files: fileIds.length },
        changes:
          percent !== null && percent !== row.progressPercent
            ? { before: { progressPercent: row.progressPercent }, after: { progressPercent: percent } }
            : null,
      }),
    );
    await this.commit(row, statements);
    return this.detail(tenant, project, principal, row.id);
  }

  /** US-055 FR-4: evidence files (owner, collaborators, or a verifier of a completed action). */
  async uploadFiles(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    uploads: readonly File[],
  ): Promise<ActionDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    this.assertWritable(loaded);
    const can = canOf(loaded.viewer, loaded.row, loaded.collaboratorIds, true);
    if (!can.addFiles) {
      if (isActionActive(loaded.row.status) || loaded.row.status === 'completed') {
        throw new ForbiddenError();
      }
      throw new TransitionNotAllowedError(loaded.row.status);
    }
    if (uploads.length === 0) throw new ValidationError([{ path: 'files', message: 'required' }]);
    if (uploads.length > ACTION_LIMITS.filesPerUpload) {
      throw new FileLimitError(ACTION_LIMITS.filesPerUpload);
    }
    const existing = await this.ctx.repo.fileCount(loaded.row.id);
    if (existing + uploads.length > ACTION_LIMITS.filesMax) {
      throw new FileLimitError(ACTION_LIMITS.filesMax);
    }
    const now = new Date(this.ctx.now());
    const statements: Statement[] = [];
    const check = this.ctx.storageCheck(tenant.id);
    let pending = 0;
    for (const upload of uploads) {
      const stored = await this.ctx.files.store({
        companyId: tenant.id,
        category: 'action_evidence',
        uploadedBy: principal.userId,
        file: upload,
        beforeWrite: async (size) => {
          await check(pending + size);
          pending += size;
        },
      });
      statements.push(
        stored.statement,
        this.ctx.repo.addFile(loaded.row.id, stored.row.id, principal.userId, now),
        ...this.ctx.record(principal.userId, loaded.row, project.code, {
          audit: 'action.file_added',
          activity: 'action.file_added',
          newValue: {
            fileId: stored.row.id,
            sizeBytes: stored.row.sizeBytes,
            contentType: stored.row.contentType,
          },
          snapshot: { fileName: stored.row.fileName },
        }),
      );
    }
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    return this.detail(tenant, project, principal, loaded.row.id);
  }

  async openFile(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    fileId: string,
  ): Promise<OpenedFile | null> {
    const { row } = await this.load(tenant, project, principal, actionId);
    if (!(await this.ctx.repo.hasFile(row.id, fileId))) return null;
    return this.ctx.files.open(fileId, tenant.id);
  }

  /** Files given as evidence must belong to this action. */
  private async ownFiles(row: ActionRow, ids: readonly string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    for (const id of unique) {
      if (!(await this.ctx.repo.hasFile(row.id, id))) {
        throw new ValidationError([{ path: 'fileIds', message: 'fileNotOnAction' }]);
      }
    }
    return unique;
  }

  // ---- Workflow (US-055 – US-058, T-58) -------------------------------------------------

  async transition(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    input: TransitionRequest,
  ): Promise<ActionDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    this.assertWritable(loaded);
    const { row } = loaded;
    const step = workflowStep(input.transition);
    if (!step.from.includes(row.status)) throw new TransitionNotAllowedError(row.status);
    const facts = factsOf(loaded.viewer, row, loaded.collaboratorIds);
    switch (step.actor) {
      case 'owner':
        if (!facts.owner) throw new ForbiddenError();
        break;
      case 'verifier':
        if (!facts.verify) throw new ForbiddenError();
        if (facts.participant) throw new VerifierIsParticipantError();
        break;
      case 'closer':
        if (!facts.close) throw new ForbiddenError();
        break;
      case 'verifier_closer':
        if (!facts.verify || !facts.close) throw new ForbiddenError();
        if (facts.participant) throw new VerifierIsParticipantError();
        break;
    }

    const now = new Date(this.ctx.now());
    const by = principal.userId;
    const statements: Statement[] = [];
    let values: Partial<ActionRow> = {};
    const updates: ActionUpdateRow[] = [];
    const records: { audit: Parameters<ActionContext['record']>[3]; row: ActionRow }[] = [];
    const afterOf = (v: Partial<ActionRow>): ActionRow => ({ ...row, ...v, updatedAt: now, updatedBy: by });
    let notifyType: NotificationType | null = null;
    let recipients: string[] = [];
    const params: NotificationParams = {};

    switch (input.transition) {
      case 'start': {
        values = { status: 'in_progress', startedAt: now };
        updates.push(this.updateRow(row.id, 'start', by, now));
        records.push({
          row: afterOf(values),
          audit: {
            audit: 'action.started',
            activity: 'action.started',
            changes: { before: { status: row.status }, after: { status: 'in_progress' } },
          },
        });
        break;
      }
      case 'complete': {
        const evidence = await this.ownFiles(row, input.evidenceFileIds ?? []);
        if (EVIDENCE_REQUIRED_PRIORITIES.includes(row.priority) && evidence.length === 0) {
          throw new EvidenceRequiredError(row.priority);
        }
        const onTime = this.ctx.today(tenant) <= row.dueOn;
        values = {
          status: 'completed',
          completedAt: now,
          completedOnTime: onTime,
          progressPercent: 100,
          startedAt: row.startedAt ?? now,
        };
        updates.push({
          ...this.updateRow(row.id, 'completion', by, now),
          note: input.note,
          percent: 100,
          fileIds: JSON.stringify(evidence),
        });
        records.push({
          row: afterOf(values),
          audit: {
            audit: 'action.completed',
            activity: 'action.completed',
            newValue: { evidence, onTime, noteLength: input.note.length },
            changes: { before: { status: row.status }, after: { status: 'completed' } },
          },
        });
        notifyType = 'action.verification_needed';
        recipients = await this.verifiers(tenant, project, row, loaded.collaboratorIds);
        break;
      }
      case 'verify':
      case 'verify_and_close': {
        const evidence = await this.ownFiles(row, input.evidenceFileIds ?? []);
        values = { status: 'verified', verifiedAt: now, verifiedBy: by, verificationMethod: input.method };
        updates.push({
          ...this.updateRow(row.id, 'verification', by, now),
          note: input.note ?? null,
          method: input.method,
          fileIds: JSON.stringify(evidence),
        });
        records.push({
          row: afterOf(values),
          audit: {
            audit: 'action.verified',
            activity: 'action.verified',
            newValue: { method: input.method, evidence },
            changes: { before: { status: row.status }, after: { status: 'verified' } },
            snapshot: { method: input.method },
          },
        });
        notifyType = 'action.verified';
        recipients = [row.ownerId, row.createdBy];
        if (input.transition === 'verify_and_close') {
          const later = new Date(now.getTime() + 1);
          values = { ...values, status: 'closed', closedAt: later, closedBy: by };
          updates.push(this.updateRow(row.id, 'closure', by, later));
          records.push({
            row: afterOf(values),
            audit: {
              audit: 'action.closed',
              activity: 'action.closed',
              newValue: { verifiedInSameStep: true },
              changes: { before: { status: 'verified' }, after: { status: 'closed' } },
            },
          });
          notifyType = 'action.closed';
          recipients = [row.ownerId, row.createdBy, ...loaded.collaboratorIds];
        }
        break;
      }
      case 'send_back': {
        values = {
          status: 'in_progress',
          completedAt: null,
          completedOnTime: null,
          progressPercent: await this.ctx.repo.lastProgressPercent(row.id),
          sendBackCount: row.sendBackCount + 1,
        };
        updates.push({ ...this.updateRow(row.id, 'send_back', by, now), note: input.reason });
        records.push({
          row: afterOf(values),
          audit: {
            audit: 'action.sent_back',
            activity: 'action.sent_back',
            newValue: { reason: input.reason },
            changes: { before: { status: row.status }, after: { status: 'in_progress' } },
            snapshot: { reason: input.reason.slice(0, 200) },
          },
        });
        notifyType = 'action.sent_back';
        recipients = [row.ownerId, ...loaded.collaboratorIds];
        params.reason = input.reason.slice(0, 120);
        break;
      }
      case 'close': {
        values = { status: 'closed', closedAt: now, closedBy: by };
        updates.push({ ...this.updateRow(row.id, 'closure', by, now), note: input.note ?? null });
        records.push({
          row: afterOf(values),
          audit: {
            audit: 'action.closed',
            activity: 'action.closed',
            newValue: { verifiedInSameStep: false },
            changes: { before: { status: row.status }, after: { status: 'closed' } },
          },
        });
        notifyType = 'action.closed';
        recipients = [row.ownerId, row.createdBy, ...loaded.collaboratorIds];
        break;
      }
    }

    const after = afterOf(values);
    statements.push(
      this.ctx.repo.updateIf(row.id, step.from, { ...values, updatedAt: now, updatedBy: by }),
      this.guard(row.id, { updatedAt: now, status: after.status }),
      ...updates.map((u) => this.ctx.repo.insertUpdate(u)),
      ...records.flatMap((r, i) =>
        this.ctx.record(by, r.row, project.code, { ...r.audit, at: now.getTime() + i }),
      ),
    );
    if (notifyType) {
      statements.push(...(await this.notify(notifyType, after, project, by, recipients, params)));
    }
    await this.commit(row, statements);
    return this.detail(tenant, project, principal, row.id);
  }

  /** O-109: who is told that a completed action needs verification. */
  private async verifiers(
    tenant: TenantCompany,
    project: ProjectRow,
    row: ActionRow,
    collaboratorIds: readonly string[],
  ): Promise<string[]> {
    const participants = new Set([row.ownerId, ...collaboratorIds]);
    const canVerify = async (userId: string) =>
      (await this.ctx.resolver.projectPermissions(userId, tenant.id, project.id)).has(
        'projects.actions.verify',
      );
    if (!participants.has(row.createdBy) && (await canVerify(row.createdBy))) return [row.createdBy];
    const onProject: string[] = [];
    for (const entry of await this.ctx.audience.projectRoles(tenant.id, project.id)) {
      if (participants.has(entry.userId)) continue;
      if ((await this.ctx.resolver.roleGrants(tenant.id, entry.roleCode)).has('projects.actions.verify')) {
        onProject.push(entry.userId);
      }
    }
    if (onProject.length > 0) return [...new Set(onProject)];
    const all = await this.ctx.audience.projectPermissionHolders(
      tenant.id,
      project.id,
      'projects.actions.verify',
      this.ctx.resolver,
    );
    return all.filter((id) => !participants.has(id));
  }

  async void(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    reason: string,
  ): Promise<ActionDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    this.requireManage(loaded);
    this.assertActive(loaded);
    const { row } = loaded;
    const now = new Date(this.ctx.now());
    const after: ActionRow = {
      ...row,
      voidedAt: now,
      voidedBy: principal.userId,
      voidReason: reason,
      updatedAt: now,
      updatedBy: principal.userId,
    };
    await this.commit(row, [
      this.ctx.repo.updateIf(row.id, ['open', 'in_progress'], {
        voidedAt: now,
        voidedBy: principal.userId,
        voidReason: reason,
        updatedAt: now,
        updatedBy: principal.userId,
      }),
      this.guard(row.id, { updatedAt: now }),
      this.ctx.repo.insertUpdate({ ...this.updateRow(row.id, 'void', principal.userId, now), note: reason }),
      ...this.ctx.record(principal.userId, after, project.code, {
        audit: 'action.voided',
        activity: 'action.voided',
        newValue: { reason },
        snapshot: { reason: reason.slice(0, 200) },
      }),
      ...(await this.notify(
        'action.voided',
        after,
        project,
        principal.userId,
        [row.ownerId, ...loaded.collaboratorIds],
        { reason: reason.slice(0, 120) },
      )),
    ]);
    return this.detail(tenant, project, principal, row.id);
  }

  // ---- Comments (PLT-22) ----------------------------------------------------------------

  private commentTarget(row: ActionRow, viewer: ActionViewer): CommentTarget {
    return {
      companyId: row.companyId,
      projectId: row.projectId,
      entityType: 'action',
      entityId: row.id,
      locked: locked(row) || viewer.archived,
    };
  }

  async comments(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    before: string | undefined,
  ): Promise<CommentPageDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    const target = this.commentTarget(loaded.row, loaded.viewer);
    const { rows, nextBefore } = await this.ctx.comments.list(target, parseCommentCursor(before));
    const authors = [...new Set(rows.map((r) => r.authorId))];
    const people = await this.people(tenant.id, project.id, authors, authors);
    return {
      comments: rows.map(
        (r): CommentDto => ({
          id: r.id,
          author: {
            id: r.authorId,
            name: people.names.get(r.authorId) ?? '',
            stillHasAccess: people.access.get(r.authorId) ?? false,
          },
          body: r.body,
          createdAt: r.createdAt.getTime(),
          editedAt: r.editedAt?.getTime() ?? null,
          canEdit: !target.locked && this.ctx.comments.editable(r, principal.userId),
        }),
      ),
      nextBefore,
      locked: target.locked,
    };
  }

  async addComment(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    body: string,
  ): Promise<CommentDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    if (loaded.viewer.archived) throw new ProjectArchivedError();
    if ((await this.ctx.comments.recentCount(principal.userId)) >= COMMENT_LIMITS.postsPerMinute) {
      throw new RateLimitedError();
    }
    const target = this.commentTarget(loaded.row, loaded.viewer);
    const { row: posted, statements } = this.ctx.comments.add(target, principal.userId, body);
    const { row } = loaded;
    const recipients = await this.ctx.withAccess(tenant.id, project.id, [
      row.ownerId,
      row.createdBy,
      ...loaded.collaboratorIds,
    ]);
    statements.push(
      ...(await this.ctx.notifications.groupedEntries(
        {
          type: 'action.comment_added',
          companyId: tenant.id,
          projectId: project.id,
          entityType: 'action',
          entityId: row.id,
          actorUserId: principal.userId,
          params: this.params(row, project),
          recipients,
        },
        COMMENT_LIMITS.groupWindowMs,
      )),
    );
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    const names = await userSummaries(this.ctx.db, [principal.userId]);
    return {
      id: posted.id,
      author: {
        id: principal.userId,
        name: names.get(principal.userId)?.fullName ?? '',
        stillHasAccess: true,
      },
      body: posted.body,
      createdAt: posted.createdAt.getTime(),
      editedAt: null,
      canEdit: true,
    };
  }

  async editComment(
    tenant: TenantCompany,
    project: ProjectRow,
    principal: Principal,
    actionId: string,
    commentId: string,
    body: string,
  ): Promise<CommentDto> {
    const loaded = await this.load(tenant, project, principal, actionId);
    if (loaded.viewer.archived) throw new ProjectArchivedError();
    const target = this.commentTarget(loaded.row, loaded.viewer);
    const existing = await this.ctx.comments.find(target, commentId);
    if (!existing) throw new NotFoundError();
    const { row: edited, statements } = this.ctx.comments.edit(target, existing, principal.userId, body);
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    const names = await userSummaries(this.ctx.db, [principal.userId]);
    return {
      id: edited.id,
      author: {
        id: principal.userId,
        name: names.get(principal.userId)?.fullName ?? '',
        stillHasAccess: true,
      },
      body: edited.body,
      createdAt: edited.createdAt.getTime(),
      editedAt: edited.editedAt?.getTime() ?? null,
      canEdit: this.ctx.comments.editable(edited, principal.userId),
    };
  }

  // ---- Helpers --------------------------------------------------------------------------

  private updateRow(
    actionId: string,
    kind: ActionUpdateRow['kind'],
    by: string,
    at: Date,
  ): ActionUpdateRow {
    return {
      id: generateId(),
      actionId,
      kind,
      note: null,
      percent: null,
      method: null,
      fileIds: '[]',
      createdBy: by,
      createdAt: at,
    };
  }

  private params(row: ActionRow, project: ProjectRow): NotificationParams {
    return {
      projectCode: project.code,
      actionReference: actionReference(project.code, row.number),
      actionTitle: row.title.slice(0, 80),
      priority: row.priority,
      dueOn: row.dueOn,
    };
  }

  private async notify(
    type: NotificationType,
    row: ActionRow,
    project: ProjectRow,
    actorUserId: string,
    recipients: readonly string[],
    extra: NotificationParams = {},
  ): Promise<Statement[]> {
    return this.ctx.notifications.entries({
      type,
      companyId: row.companyId,
      projectId: row.projectId,
      entityType: 'action',
      entityId: row.id,
      actorUserId,
      params: { ...this.params(row, project), ...extra },
      recipients: await this.ctx.withAccess(row.companyId, row.projectId, recipients),
    });
  }

  /**
   * T-58: fails the whole batch unless the conditional update above it applied (the action has
   * our `updated_at` stamp and the expected status). `json('…')` raises "malformed JSON".
   */
  private guard(actionId: string, expect: { updatedAt: Date; status?: ActionStatus }): Statement {
    return this.ctx.repo.guard(actionId, expect.updatedAt, expect.status);
  }

  /** Commits; a failed guard means someone changed the action first. */
  private async commit(row: ActionRow, statements: Statement[]): Promise<void> {
    try {
      await new UnitOfWork(this.ctx.db).add(...statements).commit();
    } catch (error) {
      const text = String((error as { message?: unknown } | null)?.message ?? error);
      if (!text.includes(GUARD_MESSAGE)) throw error;
      const current = await this.ctx.repo.statusOf(row.id);
      throw new TransitionNotAllowedError(current?.status ?? row.status);
    }
  }
}

