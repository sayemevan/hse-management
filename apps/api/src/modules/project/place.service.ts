import {
  type ActivityAction,
  type CreatePlaceRequest,
  generateId,
  PLACE_LIMITS,
  PLACE_PARENT_LEVEL,
  type PlaceDto,
  type PlaceTreeDto,
  placeNameKey,
  type UpdatePlaceRequest,
} from '@hse/shared';

import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/http/request-meta';
import type { Database } from '../../database/client';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { ActivityService, changedFields } from '../../platform/activity';
import { type AuditAction, AuditLogService } from '../../platform/audit-log';
import {
  PlaceCodeTakenError,
  PlaceInactiveError,
  PlaceInUseError,
  PlaceLevelInvalidError,
  PlaceLimitReachedError,
  PlaceNameTakenError,
} from './place.errors';
import { type PlaceChanges, PlaceRepository } from './place.repository';
import type { PlaceRow } from './place.schema';
import { countRecordsUsing } from './place-usage';
import { ProjectArchivedError } from './project.errors';
import type { ProjectRow } from './project.schema';
import { NotFoundError } from '../../core/errors/app-error';

export interface PlaceServiceDeps {
  db: Database;
  meta: RequestMeta;
  clock: () => number;
}

/** US-019 – US-021: a project's Areas, Locations and Work Zones (shared rules, T-38, T-39). */
export class PlaceService {
  private readonly places: PlaceRepository;
  private readonly audit: AuditLogService;
  private readonly activity: ActivityService;

  constructor(private readonly deps: PlaceServiceDeps) {
    this.places = new PlaceRepository(deps.db);
    this.audit = new AuditLogService(deps.db, deps.meta, deps.clock);
    this.activity = new ActivityService(deps.db, deps.clock);
  }

  /** US-019 FR-1: the whole tree in one call. */
  async tree(project: ProjectRow, includeInactive: boolean): Promise<PlaceTreeDto> {
    const rows = await this.places.listForProject(project.companyId, project.id);
    return { areas: buildTree(rows, includeInactive) };
  }

  /** US-019 FR-2, US-020 FR-1, US-021 FR-1. */
  async create(
    project: ProjectRow,
    principal: Principal,
    input: CreatePlaceRequest & { name: string },
  ): Promise<PlaceDto> {
    assertWritable(project);
    const parentId = input.parentId ?? null;
    let parent: PlaceRow | undefined;
    const wantedParent = PLACE_PARENT_LEVEL[input.level];
    if (wantedParent) {
      if (!parentId) throw new PlaceLevelInvalidError();
      parent = await this.places.find(project.companyId, project.id, parentId);
      if (parent?.level !== wantedParent) throw new PlaceLevelInvalidError();
      if (!parent.active) throw new PlaceInactiveError();
    } else if (parentId) {
      throw new PlaceLevelInvalidError();
    }

    const siblings = await this.places.siblings(project.id, parentId);
    if (siblings.length >= PLACE_LIMITS.siblingsMax) {
      throw new PlaceLimitReachedError(PLACE_LIMITS.siblingsMax);
    }
    if ((await this.places.countForProject(project.id)) >= PLACE_LIMITS.totalMax) {
      throw new PlaceLimitReachedError(PLACE_LIMITS.totalMax);
    }
    const nameKey = placeNameKey(input.name);
    const code = input.code ?? null;
    assertUnique(siblings, nameKey, code, null);

    const id = generateId();
    const now = this.deps.clock();
    const values = {
      level: input.level,
      parentId,
      name: input.name,
      code,
      description: input.description ?? null,
    };
    await new UnitOfWork(this.deps.db)
      .add(
        this.places.insert({
          id,
          companyId: project.companyId,
          projectId: project.id,
          nameKey,
          position: (siblings.at(-1)?.position ?? 0) + 1,
          createdBy: principal.userId,
          now,
          ...values,
        }),
        ...this.record(project, principal, 'created', id, {
          snapshot: { name: input.name, level: input.level, parentName: parent?.name },
          newValue: values,
          changes: {
            before: {},
            after: { name: input.name, code, description: values.description },
          },
        }),
      )
      .commit();
    return toDto(await this.required(project, id), []);
  }

  /** US-019 FR-3. */
  async update(
    project: ProjectRow,
    principal: Principal,
    placeId: string,
    input: UpdatePlaceRequest,
  ): Promise<PlaceDto> {
    assertWritable(project);
    const current = await this.required(project, placeId);
    const changes: PlaceChanges = {};
    if (input.name !== undefined && input.name !== current.name) {
      changes.name = input.name;
      changes.nameKey = placeNameKey(input.name);
    }
    if (input.code !== undefined && (input.code ?? null) !== current.code) {
      changes.code = input.code ?? null;
    }
    if (input.description !== undefined && (input.description ?? null) !== current.description) {
      changes.description = input.description ?? null;
    }
    if (Object.keys(changes).length === 0) return toDto(current, []);

    const siblings = await this.places.siblings(project.id, current.parentId);
    assertUnique(
      siblings,
      changes.nameKey ?? null,
      changes.code === undefined ? null : changes.code,
      current.id,
    );
    const before = {
      name: current.name,
      code: current.code,
      description: current.description,
    };
    const after = { ...before, ...pick(changes, ['name', 'code', 'description']) };
    await new UnitOfWork(this.deps.db)
      .add(
        this.places.update(current.id, changes, principal.userId, this.deps.clock()),
        ...this.record(project, principal, 'updated', current.id, {
          snapshot: { name: after.name, level: current.level },
          oldValue: before,
          newValue: after,
          changes: changedFields(before, after),
        }),
      )
      .commit();
    return toDto(await this.required(project, current.id), []);
  }

  /** US-019 FR-4: swaps positions with the neighbour. */
  async move(
    project: ProjectRow,
    principal: Principal,
    placeId: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    assertWritable(project);
    const current = await this.required(project, placeId);
    const siblings = await this.places.siblings(project.id, current.parentId);
    const index = siblings.findIndex((row) => row.id === current.id);
    const neighbour = siblings[direction === 'up' ? index - 1 : index + 1];
    if (!neighbour) return;
    const now = this.deps.clock();
    await new UnitOfWork(this.deps.db)
      .add(
        this.places.setPosition(current.id, neighbour.position, principal.userId, now),
        this.places.setPosition(neighbour.id, current.position, principal.userId, now),
        ...this.record(project, principal, 'moved', current.id, {
          snapshot: { name: current.name, level: current.level },
          newValue: { direction },
        }),
      )
      .commit();
  }

  /** US-019 FR-5: the place and everything under it. Returns how many were deactivated. */
  async deactivate(project: ProjectRow, principal: Principal, placeId: string): Promise<number> {
    assertWritable(project);
    const current = await this.required(project, placeId);
    const rows = await this.places.listForProject(project.companyId, project.id);
    const ids = [current.id, ...descendantsOf(rows, current.id)].filter(
      (id) => rows.find((row) => row.id === id)?.active,
    );
    if (ids.length === 0) return 0;
    await new UnitOfWork(this.deps.db)
      .add(
        this.places.setActive(ids, false, principal.userId, this.deps.clock()),
        ...this.record(project, principal, 'deactivated', current.id, {
          snapshot: { name: current.name, level: current.level, count: ids.length - 1 },
          newValue: { descendants: ids.length - 1 },
        }),
      )
      .commit();
    return ids.length;
  }

  /** US-019 FR-5: only the place itself, and only under an active parent. */
  async reactivate(project: ProjectRow, principal: Principal, placeId: string): Promise<void> {
    assertWritable(project);
    const current = await this.required(project, placeId);
    if (current.active) return;
    if (current.parentId) {
      const parent = await this.places.find(project.companyId, project.id, current.parentId);
      if (!parent?.active) throw new PlaceInactiveError();
    }
    await new UnitOfWork(this.deps.db)
      .add(
        this.places.setActive([current.id], true, principal.userId, this.deps.clock()),
        ...this.record(project, principal, 'reactivated', current.id, {
          snapshot: { name: current.name, level: current.level },
        }),
      )
      .commit();
  }

  /** US-019 FR-6 (T-39). */
  async delete(project: ProjectRow, principal: Principal, placeId: string): Promise<void> {
    assertWritable(project);
    const current = await this.required(project, placeId);
    if ((await this.places.countChildren(current.id)) > 0) throw new PlaceInUseError('children');
    if ((await countRecordsUsing(this.deps.db, current.id)) > 0) {
      throw new PlaceInUseError('records');
    }
    const values = {
      level: current.level,
      parentId: current.parentId,
      name: current.name,
      code: current.code,
      description: current.description,
    };
    await new UnitOfWork(this.deps.db)
      .add(
        this.places.delete(current.id),
        ...this.record(project, principal, 'deleted', current.id, {
          snapshot: { name: current.name, level: current.level },
          oldValue: values,
        }),
      )
      .commit();
  }

  private async required(project: ProjectRow, placeId: string): Promise<PlaceRow> {
    const row = await this.places.find(project.companyId, project.id, placeId);
    if (!row) throw new NotFoundError();
    return row;
  }

  /** The audit entry and the timeline entry of one change. */
  private record(
    project: ProjectRow,
    principal: Principal,
    verb: 'created' | 'updated' | 'moved' | 'deactivated' | 'reactivated' | 'deleted',
    placeId: string,
    details: {
      snapshot: { name: string; level: string; parentName?: string; count?: number };
      oldValue?: Record<string, unknown>;
      newValue?: Record<string, unknown>;
      changes?: { before: Record<string, unknown>; after: Record<string, unknown> } | null;
    },
  ): Statement[] {
    const auditAction = `place.${verb}` as AuditAction;
    const activityAction = `place.${verb}` as ActivityAction;
    return [
      this.audit.entry({
        action: auditAction,
        actorUserId: principal.userId,
        companyId: project.companyId,
        projectId: project.id,
        entityType: 'place',
        entityId: placeId,
        oldValue: details.oldValue ?? null,
        newValue: { level: details.snapshot.level, ...(details.newValue ?? {}) },
      }),
      this.activity.entry({
        action: activityAction,
        companyId: project.companyId,
        projectId: project.id,
        entityType: 'place',
        entityId: placeId,
        actorUserId: principal.userId,
        changes: details.changes ?? null,
        snapshot: {
          projectCode: project.code,
          projectName: project.name,
          placeName: details.snapshot.name,
          placeLevel: details.snapshot.level,
          ...(details.snapshot.parentName ? { parentName: details.snapshot.parentName } : {}),
          ...(details.snapshot.count === undefined ? {} : { count: details.snapshot.count }),
        },
      }),
    ];
  }
}

function assertWritable(project: ProjectRow): void {
  if (project.status === 'archived') throw new ProjectArchivedError();
}

/** O-60: names and codes are unique among siblings, active or inactive. */
function assertUnique(
  siblings: readonly PlaceRow[],
  nameKey: string | null,
  code: string | null,
  exceptId: string | null,
): void {
  const others = siblings.filter((row) => row.id !== exceptId);
  if (nameKey && others.some((row) => row.nameKey === nameKey)) throw new PlaceNameTakenError();
  if (code && others.some((row) => row.code === code)) throw new PlaceCodeTakenError();
}

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) if (value[key] !== undefined) result[key] = value[key];
  return result;
}

function descendantsOf(rows: readonly PlaceRow[], id: string): string[] {
  const children = rows.filter((row) => row.parentId === id);
  return children.flatMap((child) => [child.id, ...descendantsOf(rows, child.id)]);
}

function toDto(row: PlaceRow, children: PlaceDto[]): PlaceDto {
  return {
    id: row.id,
    level: row.level,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    description: row.description,
    position: row.position,
    active: row.active,
    children,
  };
}

export function buildTree(rows: readonly PlaceRow[], includeInactive: boolean): PlaceDto[] {
  const visible = rows.filter((row) => includeInactive || row.active);
  const byParent = new Map<string | null, PlaceRow[]>();
  for (const row of visible) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  const build = (parentId: string | null): PlaceDto[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((row) => toDto(row, build(row.id)));
  return build(null);
}
