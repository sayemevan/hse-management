import type {
  ChangeProjectStatusRequest,
  CreateProjectRequest,
  PaginationMeta,
  ProjectDto,
  ProjectListItemDto,
  ProjectStatus,
  UpdateProjectRequest,
} from '@hse/shared';

import { authorizedRequest } from '@/modules/auth/auth-session';

export interface ProjectPage {
  items: ProjectListItemDto[];
  meta: PaginationMeta | undefined;
}

const path = (id: string, suffix = '') => `/projects/${encodeURIComponent(id)}${suffix}`;

/** US-016 – US-018. */
export const projectsService = {
  async list(search: string, statuses: ProjectStatus[], page: number): Promise<ProjectPage> {
    const query = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (search.trim()) query.set('search', search.trim());
    if (statuses.length > 0) query.set('status', statuses.join(','));
    const response = await authorizedRequest<ProjectListItemDto[]>(`/projects?${query.toString()}`);
    return { items: response.data, meta: response.meta as PaginationMeta | undefined };
  },

  async get(id: string): Promise<ProjectDto> {
    return (await authorizedRequest<ProjectDto>(path(id))).data;
  },

  async create(request: CreateProjectRequest): Promise<ProjectDto> {
    return (await authorizedRequest<ProjectDto>('/projects', { method: 'POST', body: request }))
      .data;
  },

  async update(id: string, request: UpdateProjectRequest): Promise<ProjectDto> {
    return (await authorizedRequest<ProjectDto>(path(id), { method: 'PATCH', body: request })).data;
  },

  async changeStatus(id: string, request: ChangeProjectStatusRequest): Promise<ProjectDto> {
    return (
      await authorizedRequest<ProjectDto>(path(id, '/status'), { method: 'POST', body: request })
    ).data;
  },

  async archive(id: string, version: number): Promise<ProjectDto> {
    return (
      await authorizedRequest<ProjectDto>(path(id, '/archive'), {
        method: 'POST',
        body: { version },
      })
    ).data;
  },

  async restore(id: string, version: number): Promise<ProjectDto> {
    return (
      await authorizedRequest<ProjectDto>(path(id, '/restore'), {
        method: 'POST',
        body: { version },
      })
    ).data;
  },
};
