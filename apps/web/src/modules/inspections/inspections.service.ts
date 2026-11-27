import type {
  CategoryRequest,
  CommentDto,
  CommentPageDto,
  CreateInspectionRequest,
  CreateTemplateRequest,
  FindingDto,
  FindingPageDto,
  InspectionCategoryDto,
  InspectionDto,
  InspectionPageDto,
  InspectionTransitionRequest,
  MyInspectionsPageDto,
  RaiseFindingActionRequest,
  ReadinessDto,
  SaveDraftRequest,
  TemplateDetailDto,
  TemplateSummaryDto,
  TemplateVersionDto,
  TemplateVersionListItemDto,
  TimelinePageDto,
  UpdateFindingRequest,
  UpdateInspectionRequest,
} from '@hse/shared';

import { authorizedBlob, authorizedRequest } from '@/modules/auth/auth-session';

const enc = encodeURIComponent;
const base = (projectId: string) => `/projects/${enc(projectId)}/inspections`;
const one = (projectId: string, id: string, suffix = '') => `${base(projectId)}/${enc(id)}${suffix}`;

export function queryString(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** US-031, US-032: categories and templates (company level). */
export const templatesService = {
  async categories(): Promise<InspectionCategoryDto[]> {
    return (await authorizedRequest<InspectionCategoryDto[]>('/inspection-categories')).data;
  },
  async createCategory(body: CategoryRequest): Promise<InspectionCategoryDto> {
    return (await authorizedRequest<InspectionCategoryDto>('/inspection-categories', { method: 'POST', body })).data;
  },
  async updateCategory(id: string, body: CategoryRequest): Promise<InspectionCategoryDto> {
    return (await authorizedRequest<InspectionCategoryDto>(`/inspection-categories/${enc(id)}`, { method: 'PATCH', body }))
      .data;
  },
  async moveCategory(id: string, direction: 'up' | 'down'): Promise<InspectionCategoryDto[]> {
    return (
      await authorizedRequest<InspectionCategoryDto[]>(`/inspection-categories/${enc(id)}/move`, {
        method: 'POST',
        body: { direction },
      })
    ).data;
  },
  async setCategoryActive(id: string, active: boolean): Promise<InspectionCategoryDto> {
    return (
      await authorizedRequest<InspectionCategoryDto>(
        `/inspection-categories/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`,
        { method: 'POST' },
      )
    ).data;
  },
  async list(filters: { status?: 'active' | 'retired' } = {}): Promise<{ items: TemplateSummaryDto[]; canManage: boolean }> {
    return (
      await authorizedRequest<{ items: TemplateSummaryDto[]; canManage: boolean }>(
        `/inspection-templates${queryString(filters)}`,
      )
    ).data;
  },
  async create(body: CreateTemplateRequest): Promise<TemplateDetailDto> {
    return (await authorizedRequest<TemplateDetailDto>('/inspection-templates', { method: 'POST', body })).data;
  },
  async get(id: string): Promise<TemplateDetailDto> {
    return (await authorizedRequest<TemplateDetailDto>(`/inspection-templates/${enc(id)}`)).data;
  },
  async saveDraft(id: string, body: SaveDraftRequest): Promise<TemplateDetailDto> {
    return (await authorizedRequest<TemplateDetailDto>(`/inspection-templates/${enc(id)}/draft`, { method: 'PUT', body }))
      .data;
  },
  async createDraft(id: string): Promise<TemplateDetailDto> {
    return (await authorizedRequest<TemplateDetailDto>(`/inspection-templates/${enc(id)}/draft`, { method: 'POST' })).data;
  },
  async discardDraft(id: string): Promise<void> {
    await authorizedRequest(`/inspection-templates/${enc(id)}/draft`, { method: 'DELETE' });
  },
  async publish(id: string): Promise<TemplateDetailDto> {
    return (await authorizedRequest<TemplateDetailDto>(`/inspection-templates/${enc(id)}/publish`, { method: 'POST' }))
      .data;
  },
  async setRetired(id: string, retired: boolean): Promise<TemplateDetailDto> {
    return (
      await authorizedRequest<TemplateDetailDto>(
        `/inspection-templates/${enc(id)}/${retired ? 'retire' : 'reactivate'}`,
        { method: 'POST' },
      )
    ).data;
  },
  async duplicate(id: string): Promise<TemplateDetailDto> {
    return (await authorizedRequest<TemplateDetailDto>(`/inspection-templates/${enc(id)}/duplicate`, { method: 'POST' }))
      .data;
  },
  async remove(id: string): Promise<void> {
    await authorizedRequest(`/inspection-templates/${enc(id)}`, { method: 'DELETE' });
  },
  async versions(id: string): Promise<TemplateVersionListItemDto[]> {
    return (await authorizedRequest<TemplateVersionListItemDto[]>(`/inspection-templates/${enc(id)}/versions`)).data;
  },
  async version(id: string, versionNo: number): Promise<TemplateVersionDto> {
    return (
      await authorizedRequest<TemplateVersionDto>(`/inspection-templates/${enc(id)}/versions/${String(versionNo)}`)
    ).data;
  },
};

export interface InspectionFilters {
  status?: string[];
  filter?: string;
  template?: string;
  inspector?: string;
  cancelled?: boolean;
  search?: string;
  offset?: number;
}

/** PLT-32, US-033 – US-039 (online calls; offline changes go through the outbox). */
export const inspectionsService = {
  async list(projectId: string, filters: InspectionFilters): Promise<InspectionPageDto> {
    return (await authorizedRequest<InspectionPageDto>(`${base(projectId)}${queryString({ ...filters })}`)).data;
  },
  async mine(tab: 'assigned' | 'in_progress' | 'to_review'): Promise<MyInspectionsPageDto> {
    return (await authorizedRequest<MyInspectionsPageDto>(`/me/inspections?tab=${tab}`)).data;
  },
  async findings(projectId: string, filters: Record<string, unknown>): Promise<FindingPageDto> {
    return (
      await authorizedRequest<FindingPageDto>(`/projects/${enc(projectId)}/inspection-findings${queryString(filters)}`)
    ).data;
  },
  async create(projectId: string, body: CreateInspectionRequest): Promise<InspectionDto> {
    return (await authorizedRequest<InspectionDto>(base(projectId), { method: 'POST', body })).data;
  },
  async get(projectId: string, id: string): Promise<InspectionDto> {
    return (await authorizedRequest<InspectionDto>(one(projectId, id))).data;
  },
  async update(projectId: string, id: string, body: UpdateInspectionRequest): Promise<InspectionDto> {
    return (await authorizedRequest<InspectionDto>(one(projectId, id), { method: 'PATCH', body })).data;
  },
  async transition(projectId: string, id: string, body: InspectionTransitionRequest): Promise<InspectionDto> {
    return (await authorizedRequest<InspectionDto>(one(projectId, id, '/transitions'), { method: 'POST', body })).data;
  },
  async readiness(projectId: string, id: string): Promise<ReadinessDto> {
    return (await authorizedRequest<ReadinessDto>(one(projectId, id, '/readiness'))).data;
  },
  async reviewStart(projectId: string, id: string): Promise<void> {
    await authorizedRequest(one(projectId, id, '/review-start'), { method: 'POST' });
  },
  async updateFinding(projectId: string, id: string, findingId: string, body: UpdateFindingRequest): Promise<FindingDto> {
    return (
      await authorizedRequest<FindingDto>(one(projectId, id, `/findings/${enc(findingId)}`), { method: 'PATCH', body })
    ).data;
  },
  async raiseAction(
    projectId: string,
    id: string,
    findingId: string,
    body: RaiseFindingActionRequest,
  ): Promise<{ actionId: string; reference: string }> {
    return (
      await authorizedRequest<{ actionId: string; reference: string }>(
        one(projectId, id, `/findings/${enc(findingId)}/actions`),
        { method: 'POST', body },
      )
    ).data;
  },
  async noAction(projectId: string, id: string, findingId: string, reason: string): Promise<FindingDto> {
    return (
      await authorizedRequest<FindingDto>(one(projectId, id, `/findings/${enc(findingId)}/no-action`), {
        method: 'POST',
        body: { reason },
      })
    ).data;
  },
  async history(projectId: string, id: string, before?: string | null): Promise<TimelinePageDto> {
    return (await authorizedRequest<TimelinePageDto>(one(projectId, id, `/history${queryString({ before })}`))).data;
  },
  async comments(projectId: string, id: string, before?: string | null): Promise<CommentPageDto> {
    return (await authorizedRequest<CommentPageDto>(one(projectId, id, `/comments${queryString({ before })}`))).data;
  },
  async addComment(projectId: string, id: string, body: string): Promise<CommentDto> {
    return (await authorizedRequest<CommentDto>(one(projectId, id, '/comments'), { method: 'POST', body: { body } })).data;
  },
  async editComment(projectId: string, id: string, commentId: string, body: string): Promise<CommentDto> {
    return (
      await authorizedRequest<CommentDto>(one(projectId, id, `/comments/${enc(commentId)}`), {
        method: 'PATCH',
        body: { body },
      })
    ).data;
  },
  async file(projectId: string, id: string, fileId: string): Promise<Blob> {
    return authorizedBlob(one(projectId, id, `/files/${enc(fileId)}`));
  },
};
