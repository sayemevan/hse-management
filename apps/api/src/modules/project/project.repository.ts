import type { ProjectStatus } from '@hse/shared';
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { project, type ProjectRow } from './project.schema';

export type NewProject = Omit<
  typeof project.$inferInsert,
  'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'statusBeforeHold' | 'statusBeforeArchive'
> & { id: string; now: number };

export type ProjectChanges = Partial<
  Pick<
    ProjectRow,
    | 'code'
    | 'name'
    | 'clientName'
    | 'contractNumber'
    | 'description'
    | 'city'
    | 'countryCode'
    | 'startDate'
    | 'expectedEndDate'
    | 'status'
    | 'statusBeforeHold'
    | 'statusBeforeArchive'
    | 'statusChangedAt'
    | 'archivedAt'
    | 'archivedBy'
  >
>;

export interface ProjectListFilter {
  /** null = every project of the company; otherwise only these ids. */
  projectIds: string[] | null;
  search?: string;
  statuses: ProjectStatus[];
  limit: number;
  offset: number;
}

function likePattern(search: string): string {
  return `%${search.toLowerCase().replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
}

/** The only code that reads or writes the `project` table. Always scoped to one company. */
export class ProjectRepository {
  constructor(private readonly db: Database) {}

  find(companyId: string, id: string): Promise<ProjectRow | undefined> {
    return this.db
      .select()
      .from(project)
      .where(and(eq(project.companyId, companyId), eq(project.id, id)))
      .get();
  }

  findMany(companyId: string, ids: readonly string[]): Promise<ProjectRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(project)
      .where(and(eq(project.companyId, companyId), inArray(project.id, [...new Set(ids)])))
      .all();
  }

  async codeTaken(companyId: string, code: string, exceptId?: string): Promise<boolean> {
    const row = await this.db
      .select({ id: project.id })
      .from(project)
      .where(
        and(
          eq(project.companyId, companyId),
          eq(project.code, code),
          exceptId ? ne(project.id, exceptId) : undefined,
        ),
      )
      .get();
    return row !== undefined;
  }

  /** O-52: projects that count towards the plan limit. */
  async countNotArchived(companyId: string): Promise<number> {
    const row = await this.db
      .select({ value: count() })
      .from(project)
      .where(and(eq(project.companyId, companyId), ne(project.status, 'archived')))
      .get();
    return row?.value ?? 0;
  }

  async list(
    companyId: string,
    filter: ProjectListFilter,
  ): Promise<{ rows: ProjectRow[]; total: number }> {
    if (filter.projectIds?.length === 0) return { rows: [], total: 0 };
    const pattern = filter.search ? likePattern(filter.search) : null;
    const where = and(
      eq(project.companyId, companyId),
      filter.projectIds ? inArray(project.id, filter.projectIds) : undefined,
      filter.statuses.length > 0
        ? inArray(project.status, filter.statuses)
        : ne(project.status, 'archived'),
      pattern
        ? sql`(lower(${project.name}) like ${pattern} escape '\\'
            or lower(${project.code}) like ${pattern} escape '\\'
            or lower(${project.clientName}) like ${pattern} escape '\\')`
        : undefined,
    );
    const [totalRow, rows] = await Promise.all([
      this.db.select({ value: count() }).from(project).where(where).get(),
      this.db
        .select()
        .from(project)
        .where(where)
        .orderBy(asc(project.code))
        .limit(filter.limit)
        .offset(filter.offset)
        .all(),
    ]);
    return { rows, total: totalRow?.value ?? 0 };
  }

  /** PLT-19 FR-1 (O-70): viewable projects that aren't archived. */
  async listForSwitcher(
    companyId: string,
    filter: { projectIds: string[] | null; search?: string; limit: number },
  ): Promise<ProjectRow[]> {
    if (filter.projectIds?.length === 0) return [];
    const pattern = filter.search ? likePattern(filter.search) : null;
    return this.db
      .select()
      .from(project)
      .where(
        and(
          eq(project.companyId, companyId),
          ne(project.status, 'archived'),
          filter.projectIds ? inArray(project.id, filter.projectIds) : undefined,
          pattern
            ? sql`(lower(${project.name}) like ${pattern} escape '\\'
                or lower(${project.code}) like ${pattern} escape '\\')`
            : undefined,
        ),
      )
      .orderBy(asc(project.code))
      .limit(filter.limit)
      .all();
  }

  insert(input: NewProject) {
    const { now, ...values } = input;
    return this.db.insert(project).values({
      ...values,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      updatedBy: values.createdBy,
    });
  }

  /**
   * Put first in a batch: when the row changed since `version`, it writes NULL into a NOT NULL
   * column, so the whole batch (change and audit entry) fails. D1 batches can't branch; this
   * makes the version check atomic (the Sprint 4 double-review guard does the same).
   */
  guardVersion(companyId: string, id: string, version: number) {
    return this.db
      .update(project)
      .set({ code: sql`NULL` })
      .where(
        and(
          eq(project.companyId, companyId),
          eq(project.id, id),
          ne(project.updatedAt, new Date(version)),
        ),
      );
  }

  /** Updates only if nobody changed the row since `version` (US-017 FR-4). */
  update(
    companyId: string,
    id: string,
    version: number,
    changes: ProjectChanges,
    actorId: string,
    now: number,
  ) {
    return this.db
      .update(project)
      .set({ ...changes, updatedAt: new Date(now), updatedBy: actorId })
      .where(
        and(
          eq(project.companyId, companyId),
          eq(project.id, id),
          eq(project.updatedAt, new Date(version)),
        ),
      )
      .returning();
  }
}
