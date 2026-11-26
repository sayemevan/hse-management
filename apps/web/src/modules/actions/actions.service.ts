import type {
  ActionCandidateDto,
  ActionDto,
  ActionPageDto,
  ActionSummaryDto,
  AddCollaboratorsRequest,
  ChangeOwnerRequest,
  CommentDto,
  CommentPageDto,
  CreateActionRequest,
  MyActionsPageDto,
  MyActionsSummaryDto,
  MyActionTab,
  ProgressRequest,
  TimelinePageDto,
  TransitionRequest,
  UpdateActionRequest,
} from '@hse/shared';

import { authorizedBlob, authorizedRequest } from '@/modules/auth/auth-session';

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/actions`;
const one = (projectId: string, actionId: string, suffix = '') =>
  `${base(projectId)}/${encodeURIComponent(actionId)}${suffix}`;

export interface ActionListFilters {
  status?: string[];
  due?: string[];
  priority?: string[];
  type?: string[];
  owner?: string;
  place?: string;
  noAccess?: boolean;
  voided?: boolean;
  search?: string;
  cursor?: number;
}

function queryString(filters: ActionListFilters | Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || value === false) continue;
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

/** PLT-22 – PLT-24, US-053 – US-058. */
export const actionsService = {
  async list(projectId: string, filters: ActionListFilters): Promise<ActionPageDto> {
    return (await authorizedRequest<ActionPageDto>(`${base(projectId)}${queryString(filters)}`))
      .data;
  },
  async summary(projectId: string): Promise<ActionSummaryDto> {
    return (await authorizedRequest<ActionSummaryDto>(`${base(projectId)}/summary`)).data;
  },
  async candidates(projectId: string, search: string): Promise<ActionCandidateDto[]> {
    const result = await authorizedRequest<{ users: ActionCandidateDto[] }>(
      `${base(projectId)}/candidates${queryString({ search })}`,
    );
    return result.data.users;
  },
  async create(projectId: string, body: CreateActionRequest): Promise<ActionDto> {
    return (await authorizedRequest<ActionDto>(base(projectId), { method: 'POST', body })).data;
  },
  async get(projectId: string, actionId: string): Promise<ActionDto> {
    return (await authorizedRequest<ActionDto>(one(projectId, actionId))).data;
  },
  async update(projectId: string, actionId: string, body: UpdateActionRequest): Promise<ActionDto> {
    return (
      await authorizedRequest<ActionDto>(one(projectId, actionId), { method: 'PATCH', body })
    ).data;
  },
  async changeOwner(
    projectId: string,
    actionId: string,
    body: ChangeOwnerRequest,
  ): Promise<ActionDto> {
    return (
      await authorizedRequest<ActionDto>(one(projectId, actionId, '/owner'), {
        method: 'POST',
        body,
      })
    ).data;
  },
  async addCollaborators(
    projectId: string,
    actionId: string,
    body: AddCollaboratorsRequest,
  ): Promise<ActionDto> {
    return (
      await authorizedRequest<ActionDto>(one(projectId, actionId, '/collaborators'), {
        method: 'POST',
        body,
      })
    ).data;
  },
  async removeCollaborator(projectId: string, actionId: string, userId: string): Promise<void> {
    await authorizedRequest(
      one(projectId, actionId, `/collaborators/${encodeURIComponent(userId)}`),
      { method: 'DELETE' },
    );
  },
  async addProgress(projectId: string, actionId: string, body: ProgressRequest): Promise<ActionDto> {
    return (
      await authorizedRequest<ActionDto>(one(projectId, actionId, '/updates'), {
        method: 'POST',
        body,
      })
    ).data;
  },
  async uploadFiles(projectId: string, actionId: string, files: readonly File[]): Promise<ActionDto> {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    return (
      await authorizedRequest<ActionDto>(one(projectId, actionId, '/files'), {
        method: 'POST',
        body: form,
      })
    ).data;
  },
  file(projectId: string, actionId: string, fileId: string): Promise<Blob> {
    return authorizedBlob(one(projectId, actionId, `/files/${encodeURIComponent(fileId)}`));
  },
  async transition(
    projectId: string,
    actionId: string,
    body: TransitionRequest,
  ): Promise<ActionDto> {
    return (
      await authorizedRequest<ActionDto>(one(projectId, actionId, '/transitions'), {
        method: 'POST',
        body,
      })
    ).data;
  },
  async void(projectId: string, actionId: string, reason: string): Promise<ActionDto> {
    return (
      await authorizedRequest<ActionDto>(one(projectId, actionId, '/void'), {
        method: 'POST',
        body: { reason },
      })
    ).data;
  },
  async history(projectId: string, actionId: string, before: string | null): Promise<TimelinePageDto> {
    return (
      await authorizedRequest<TimelinePageDto>(
        one(projectId, actionId, `/history${queryString({ before: before ?? undefined })}`),
      )
    ).data;
  },
  async comments(projectId: string, actionId: string, before: string | null): Promise<CommentPageDto> {
    return (
      await authorizedRequest<CommentPageDto>(
        one(projectId, actionId, `/comments${queryString({ before: before ?? undefined })}`),
      )
    ).data;
  },
  async addComment(projectId: string, actionId: string, body: string): Promise<CommentDto> {
    return (
      await authorizedRequest<CommentDto>(one(projectId, actionId, '/comments'), {
        method: 'POST',
        body: { body },
      })
    ).data;
  },
  async editComment(
    projectId: string,
    actionId: string,
    commentId: string,
    body: string,
  ): Promise<CommentDto> {
    return (
      await authorizedRequest<CommentDto>(
        one(projectId, actionId, `/comments/${encodeURIComponent(commentId)}`),
        { method: 'PATCH', body: { body } },
      )
    ).data;
  },
};

/** PLT-24 My actions. */
export const myActionsService = {
  async list(tab: MyActionTab, due: string[], cursor: number): Promise<MyActionsPageDto> {
    return (
      await authorizedRequest<MyActionsPageDto>(`/me/actions${queryString({ tab, due, cursor })}`)
    ).data;
  },
  async summary(): Promise<MyActionsSummaryDto> {
    return (await authorizedRequest<MyActionsSummaryDto>('/me/actions/summary')).data;
  },
};
