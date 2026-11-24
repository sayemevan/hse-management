import type {
  AddMembersRequest,
  CreatePlaceRequest,
  MemberCandidatesDto,
  PlaceDto,
  PlaceTreeDto,
  ProjectMembersDto,
  ProjectSwitcherDto,
  TimelinePageDto,
  UpdateMemberRequest,
  UpdatePlaceRequest,
} from '@hse/shared';

import { authorizedRequest } from '@/modules/auth/auth-session';

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
const place = (projectId: string, placeId: string, suffix = '') =>
  `${base(projectId)}/places/${encodeURIComponent(placeId)}${suffix}`;

/** US-019 – US-021. */
export const placesService = {
  async tree(projectId: string, includeInactive: boolean): Promise<PlaceTreeDto> {
    const query = includeInactive ? '?includeInactive=true' : '';
    return (await authorizedRequest<PlaceTreeDto>(`${base(projectId)}/places${query}`)).data;
  },
  async create(projectId: string, request: CreatePlaceRequest): Promise<PlaceDto> {
    return (
      await authorizedRequest<PlaceDto>(`${base(projectId)}/places`, {
        method: 'POST',
        body: request,
      })
    ).data;
  },
  async update(projectId: string, placeId: string, request: UpdatePlaceRequest): Promise<PlaceDto> {
    return (
      await authorizedRequest<PlaceDto>(place(projectId, placeId), {
        method: 'PATCH',
        body: request,
      })
    ).data;
  },
  async move(projectId: string, placeId: string, direction: 'up' | 'down'): Promise<void> {
    await authorizedRequest(place(projectId, placeId, '/move'), {
      method: 'POST',
      body: { direction },
    });
  },
  async deactivate(projectId: string, placeId: string): Promise<void> {
    await authorizedRequest(place(projectId, placeId, '/deactivate'), { method: 'POST' });
  },
  async reactivate(projectId: string, placeId: string): Promise<void> {
    await authorizedRequest(place(projectId, placeId, '/reactivate'), { method: 'POST' });
  },
  async remove(projectId: string, placeId: string): Promise<void> {
    await authorizedRequest(place(projectId, placeId), { method: 'DELETE' });
  },
};

/** US-022. */
export const membersService = {
  async list(projectId: string, includePast: boolean): Promise<ProjectMembersDto> {
    const query = includePast ? '?include=past' : '';
    return (await authorizedRequest<ProjectMembersDto>(`${base(projectId)}/members${query}`)).data;
  },
  async candidates(projectId: string, search: string): Promise<MemberCandidatesDto> {
    const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    return (
      await authorizedRequest<MemberCandidatesDto>(`${base(projectId)}/members/candidates${query}`)
    ).data;
  },
  async add(projectId: string, request: AddMembersRequest): Promise<void> {
    await authorizedRequest(`${base(projectId)}/members`, { method: 'POST', body: request });
  },
  async update(
    projectId: string,
    assignmentId: string,
    request: UpdateMemberRequest,
  ): Promise<void> {
    await authorizedRequest(`${base(projectId)}/members/${encodeURIComponent(assignmentId)}`, {
      method: 'PATCH',
      body: request,
    });
  },
  async remove(projectId: string, assignmentId: string): Promise<void> {
    await authorizedRequest(`${base(projectId)}/members/${encodeURIComponent(assignmentId)}`, {
      method: 'DELETE',
    });
  },
};

/** PLT-18 and PLT-19. */
export const projectContextService = {
  async timeline(
    projectId: string,
    group: string | null,
    before: string | null,
  ): Promise<TimelinePageDto> {
    const query = new URLSearchParams();
    if (group) query.set('type', group);
    if (before) query.set('before', before);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return (await authorizedRequest<TimelinePageDto>(`${base(projectId)}/timeline${suffix}`)).data;
  },
  async switcher(search = ''): Promise<ProjectSwitcherDto> {
    const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    return (await authorizedRequest<ProjectSwitcherDto>(`/projects/switcher${query}`)).data;
  },
  async rememberLastProject(projectId: string): Promise<void> {
    await authorizedRequest('/me/last-project', { method: 'PUT', body: { projectId } });
  },
};
