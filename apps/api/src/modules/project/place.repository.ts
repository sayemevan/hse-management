import type { PlaceLevel } from '@hse/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { place, type PlaceRow } from './place.schema';

export interface NewPlace {
  id: string;
  companyId: string;
  projectId: string;
  level: PlaceLevel;
  parentId: string | null;
  name: string;
  nameKey: string;
  code: string | null;
  description: string | null;
  position: number;
  createdBy: string;
  now: number;
}

export type PlaceChanges = Partial<Pick<PlaceRow, 'name' | 'nameKey' | 'code' | 'description'>>;

/** The only code that reads or writes the `place` table. Always scoped to one project. */
export class PlaceRepository {
  constructor(private readonly db: Database) {}

  listForProject(companyId: string, projectId: string): Promise<PlaceRow[]> {
    return this.db
      .select()
      .from(place)
      .where(and(eq(place.companyId, companyId), eq(place.projectId, projectId)))
      .orderBy(asc(place.position))
      .all();
  }

  find(companyId: string, projectId: string, id: string): Promise<PlaceRow | undefined> {
    return this.db
      .select()
      .from(place)
      .where(and(eq(place.companyId, companyId), eq(place.projectId, projectId), eq(place.id, id)))
      .get();
  }

  /** Siblings under a parent (null = the project's areas), active and inactive. */
  siblings(projectId: string, parentId: string | null): Promise<PlaceRow[]> {
    return this.db
      .select()
      .from(place)
      .where(
        and(
          eq(place.projectId, projectId),
          parentId === null ? isNull(place.parentId) : eq(place.parentId, parentId),
        ),
      )
      .orderBy(asc(place.position))
      .all();
  }

  async countForProject(projectId: string): Promise<number> {
    const row = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(place)
      .where(eq(place.projectId, projectId))
      .get();
    return row?.value ?? 0;
  }

  async countChildren(id: string): Promise<number> {
    const row = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(place)
      .where(eq(place.parentId, id))
      .get();
    return row?.value ?? 0;
  }

  /** Active places per level (PLT-19 FR-6). */
  async activeCounts(projectId: string): Promise<Record<PlaceLevel, number>> {
    const rows = await this.db
      .select({ level: place.level, value: sql<number>`count(*)` })
      .from(place)
      .where(and(eq(place.projectId, projectId), eq(place.active, true)))
      .groupBy(place.level)
      .all();
    const result: Record<PlaceLevel, number> = { area: 0, location: 0, work_zone: 0 };
    for (const row of rows) result[row.level] = row.value;
    return result;
  }

  insert(values: NewPlace): Statement {
    const { now, createdBy, ...rest } = values;
    return this.db.insert(place).values({
      ...rest,
      active: true,
      createdAt: new Date(now),
      createdBy,
      updatedAt: new Date(now),
      updatedBy: createdBy,
    });
  }

  update(id: string, changes: PlaceChanges, actorId: string, now: number): Statement {
    return this.db
      .update(place)
      .set({ ...changes, updatedAt: new Date(now), updatedBy: actorId })
      .where(eq(place.id, id));
  }

  setPosition(id: string, position: number, actorId: string, now: number): Statement {
    return this.db
      .update(place)
      .set({ position, updatedAt: new Date(now), updatedBy: actorId })
      .where(eq(place.id, id));
  }

  setActive(ids: readonly string[], active: boolean, actorId: string, now: number): Statement {
    return this.db
      .update(place)
      .set({
        active,
        deactivatedAt: active ? null : new Date(now),
        deactivatedBy: active ? null : actorId,
        updatedAt: new Date(now),
        updatedBy: actorId,
      })
      .where(inArray(place.id, [...ids]));
  }

  delete(id: string): Statement {
    return this.db.delete(place).where(eq(place.id, id));
  }
}
