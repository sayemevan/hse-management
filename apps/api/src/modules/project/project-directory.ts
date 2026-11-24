import { acceptsRecords, type ProjectStatus } from '@hse/shared';

import type { Database } from '../../database/client';
import { ProjectRepository } from './project.repository';

export interface ProjectFacts {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  acceptsRecords: boolean;
}

/**
 * What other modules may know about projects (T-35, US-016 FR-8): whether a project exists in
 * a company, its code, name and status, and whether it accepts new records (O-50).
 */
export class ProjectDirectory {
  private readonly projects: ProjectRepository;

  constructor(db: Database) {
    this.projects = new ProjectRepository(db);
  }

  async get(companyId: string, projectId: string): Promise<ProjectFacts | undefined> {
    const row = await this.projects.find(companyId, projectId);
    return row ? toFacts(row) : undefined;
  }

  async getMany(
    companyId: string,
    projectIds: readonly string[],
  ): Promise<Map<string, ProjectFacts>> {
    const rows = await this.projects.findMany(companyId, projectIds);
    return new Map(rows.map((row) => [row.id, toFacts(row)]));
  }
}

/** The project count for plan limits (PLT-12, O-52): projects not archived. */
export class ProjectCounter {
  constructor(private readonly db: Database) {}

  projects(companyId: string): Promise<number> {
    return new ProjectRepository(this.db).countNotArchived(companyId);
  }
}

function toFacts(row: {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
}): ProjectFacts {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    acceptsRecords: acceptsRecords(row.status),
  };
}
