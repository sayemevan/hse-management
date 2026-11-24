import {
  type AssignmentListDto,
  type AssignWorkforceRequest,
  type CreateWorkforceMemberRequest,
  type EmergencyContactsDto,
  type EmergencyContactsRequest,
  type MyWorkforceDto,
  type ProjectWorkforcePageDto,
  RECORD_KIND_PATHS,
  type RecordKind,
  type TimelinePageDto,
  type UpdateAssignmentRequest,
  type UpdateWorkforceMemberRequest,
  type WorkforceCandidatesDto,
  type WorkforceDuplicatesDto,
  type WorkforceList,
  type WorkforceListDto,
  type WorkforceListItemDto,
  type WorkforceMemberDto,
  type WorkforcePageDto,
  type WorkforceRecordDto,
  type WorkforceRecordListDto,
  type WorkforceStatusRequest,
  type WorkforceSuggestionsDto,
  type WorkforceSummaryDto,
} from '@hse/shared';

import { authorizedBlob, authorizedRequest } from '@/modules/auth/auth-session';

const member = (id: string, suffix = '') => `/workforce/${encodeURIComponent(id)}${suffix}`;
const records = (id: string, kind: RecordKind, suffix = '') =>
  member(id, `/${RECORD_KIND_PATHS[kind]}${suffix}`);

export interface DirectoryQuery {
  search?: string;
  status?: string;
  category?: string;
  position?: string;
  nationality?: string;
  project?: string;
  attention?: boolean;
  archived?: boolean;
  page?: number;
}

function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '' || value === false) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function recordForm(data: Record<string, unknown>, file: File | null): FormData {
  const form = new FormData();
  form.set('data', JSON.stringify(data));
  if (file) form.set('file', file);
  return form;
}

/** US-024 – US-030, PLT-20, PLT-21. */
export const workforceService = {
  async list(query: DirectoryQuery): Promise<WorkforcePageDto> {
    return (await authorizedRequest<WorkforcePageDto>(`/workforce${queryString({ ...query })}`))
      .data;
  },
  async summary(): Promise<WorkforceSummaryDto> {
    return (await authorizedRequest<WorkforceSummaryDto>('/workforce/summary')).data;
  },
  async duplicates(request: CreateWorkforceMemberRequest): Promise<WorkforceDuplicatesDto> {
    return (
      await authorizedRequest<WorkforceDuplicatesDto>('/workforce?dryRun=true', {
        method: 'POST',
        body: request,
      })
    ).data;
  },
  async create(request: CreateWorkforceMemberRequest): Promise<WorkforceMemberDto> {
    return (
      await authorizedRequest<WorkforceMemberDto>('/workforce', { method: 'POST', body: request })
    ).data;
  },
  async get(id: string): Promise<WorkforceMemberDto> {
    return (await authorizedRequest<WorkforceMemberDto>(member(id))).data;
  },
  async mine(): Promise<MyWorkforceDto> {
    return (await authorizedRequest<MyWorkforceDto>('/me/workforce')).data;
  },
  async update(id: string, request: UpdateWorkforceMemberRequest): Promise<WorkforceMemberDto> {
    return (
      await authorizedRequest<WorkforceMemberDto>(member(id), { method: 'PATCH', body: request })
    ).data;
  },
  async changeStatus(id: string, request: WorkforceStatusRequest): Promise<WorkforceMemberDto> {
    return (
      await authorizedRequest<WorkforceMemberDto>(member(id, '/status'), {
        method: 'POST',
        body: request,
      })
    ).data;
  },
  async archive(id: string): Promise<WorkforceMemberDto> {
    return (await authorizedRequest<WorkforceMemberDto>(member(id, '/archive'), { method: 'POST' }))
      .data;
  },
  async restore(id: string): Promise<WorkforceMemberDto> {
    return (await authorizedRequest<WorkforceMemberDto>(member(id, '/restore'), { method: 'POST' }))
      .data;
  },
  async uploadPhoto(id: string, file: File): Promise<void> {
    const form = new FormData();
    form.set('file', file);
    await authorizedRequest(member(id, '/photo'), { method: 'PUT', body: form });
  },
  async removePhoto(id: string): Promise<void> {
    await authorizedRequest(member(id, '/photo'), { method: 'DELETE' });
  },
  /** Files are served only to signed-in readers, so images are fetched with the token. */
  async blob(path: string): Promise<Blob> {
    return authorizedBlob(path.replace(/^\/api\/v1/, ''));
  },
  async userCandidates(search: string) {
    return (
      await authorizedRequest<{ items: { id: string; fullName: string; email: string }[] }>(
        `/workforce/user-candidates${queryString({ search })}`,
      )
    ).data.items;
  },
  async link(id: string, userId: string): Promise<WorkforceMemberDto> {
    return (
      await authorizedRequest<WorkforceMemberDto>(member(id, '/user-link'), {
        method: 'PUT',
        body: { userId },
      })
    ).data;
  },
  async unlink(id: string): Promise<WorkforceMemberDto> {
    return (
      await authorizedRequest<WorkforceMemberDto>(member(id, '/user-link'), { method: 'DELETE' })
    ).data;
  },
  async history(id: string, before: string | null): Promise<TimelinePageDto> {
    return (
      await authorizedRequest<TimelinePageDto>(
        member(id, `/history${queryString({ before: before ?? undefined })}`),
      )
    ).data;
  },
  async suggestions(field: 'employer' | 'department' | 'training', q: string): Promise<string[]> {
    return (
      await authorizedRequest<WorkforceSuggestionsDto>(
        `/workforce/suggestions${queryString({ field, q })}`,
      )
    ).data.items;
  },
  async assignments(id: string): Promise<AssignmentListDto> {
    return (await authorizedRequest<AssignmentListDto>(member(id, '/assignments'))).data;
  },

  // ---- Records ----
  async records(id: string, kind: RecordKind, history: boolean): Promise<WorkforceRecordListDto> {
    return (
      await authorizedRequest<WorkforceRecordListDto>(
        records(id, kind, history ? '?include=history' : ''),
      )
    ).data;
  },
  async record(id: string, kind: RecordKind, recordId: string): Promise<WorkforceRecordDto> {
    return (await authorizedRequest<WorkforceRecordDto>(records(id, kind, `/${recordId}`))).data;
  },
  async addRecord(
    id: string,
    kind: RecordKind,
    data: Record<string, unknown>,
    file: File | null,
  ): Promise<WorkforceRecordDto> {
    return (
      await authorizedRequest<WorkforceRecordDto>(records(id, kind), {
        method: 'POST',
        body: recordForm(data, file),
      })
    ).data;
  },
  async editRecord(
    id: string,
    kind: RecordKind,
    recordId: string,
    data: Record<string, unknown>,
    file: File | null,
  ): Promise<WorkforceRecordDto> {
    return (
      await authorizedRequest<WorkforceRecordDto>(records(id, kind, `/${recordId}`), {
        method: 'PATCH',
        body: recordForm(data, file),
      })
    ).data;
  },
  async renewRecord(
    id: string,
    kind: RecordKind,
    recordId: string,
    data: Record<string, unknown>,
    file: File | null,
  ): Promise<WorkforceRecordDto> {
    return (
      await authorizedRequest<WorkforceRecordDto>(records(id, kind, `/${recordId}/renew`), {
        method: 'POST',
        body: recordForm(data, file),
      })
    ).data;
  },
  async voidRecord(id: string, kind: RecordKind, recordId: string, reason: string): Promise<void> {
    await authorizedRequest(records(id, kind, `/${recordId}/void`), {
      method: 'POST',
      body: { reason },
    });
  },
  async recordFile(id: string, kind: RecordKind, recordId: string): Promise<Blob> {
    return authorizedBlob(records(id, kind, `/${recordId}/file`));
  },

  // ---- Contacts ----
  async contacts(id: string): Promise<EmergencyContactsDto> {
    return (await authorizedRequest<EmergencyContactsDto>(member(id, '/emergency-contacts'))).data;
  },
  async saveContacts(id: string, request: EmergencyContactsRequest): Promise<EmergencyContactsDto> {
    return (
      await authorizedRequest<EmergencyContactsDto>(member(id, '/emergency-contacts'), {
        method: 'PUT',
        body: request,
      })
    ).data;
  },

  // ---- Lists (PLT-21) ----
  async listItems(list: WorkforceList, includeInactive = false): Promise<WorkforceListItemDto[]> {
    return (
      await authorizedRequest<WorkforceListDto>(
        `/workforce/lists/${list}${includeInactive ? '?includeInactive=true' : ''}`,
      )
    ).data.items;
  },
  async addListItem(list: WorkforceList, name: string): Promise<void> {
    await authorizedRequest(`/workforce/lists/${list}`, { method: 'POST', body: { name } });
  },
  async renameListItem(list: WorkforceList, id: string, name: string): Promise<void> {
    await authorizedRequest(`/workforce/lists/${list}/${id}`, { method: 'PATCH', body: { name } });
  },
  async listItemAction(
    list: WorkforceList,
    id: string,
    action: 'deactivate' | 'reactivate' | 'up' | 'down' | 'delete',
  ): Promise<void> {
    if (action === 'delete') {
      await authorizedRequest(`/workforce/lists/${list}/${id}`, { method: 'DELETE' });
    } else if (action === 'up' || action === 'down') {
      await authorizedRequest(`/workforce/lists/${list}/${id}/move`, {
        method: 'POST',
        body: { direction: action },
      });
    } else {
      await authorizedRequest(`/workforce/lists/${list}/${id}/${action}`, { method: 'POST' });
    }
  },
};

/** US-025: the project's Workforce tab. */
export const projectWorkforceService = {
  async list(
    projectId: string,
    query: { search?: string; state?: string; attention?: boolean; page?: number },
  ): Promise<ProjectWorkforcePageDto> {
    return (
      await authorizedRequest<ProjectWorkforcePageDto>(
        `/projects/${projectId}/workforce${queryString(query)}`,
      )
    ).data;
  },
  async candidates(projectId: string, search: string): Promise<WorkforceCandidatesDto> {
    return (
      await authorizedRequest<WorkforceCandidatesDto>(
        `/projects/${projectId}/workforce/candidates${queryString({ search })}`,
      )
    ).data;
  },
  async assign(projectId: string, request: AssignWorkforceRequest): Promise<number> {
    return (
      await authorizedRequest<{ created: number }>(`/projects/${projectId}/workforce`, {
        method: 'POST',
        body: request,
      })
    ).data.created;
  },
  async update(projectId: string, assignmentId: string, request: UpdateAssignmentRequest) {
    await authorizedRequest(`/projects/${projectId}/workforce/${assignmentId}`, {
      method: 'PATCH',
      body: request,
    });
  },
  async end(projectId: string, assignmentId: string, endDate: string) {
    await authorizedRequest(`/projects/${projectId}/workforce/${assignmentId}/end`, {
      method: 'POST',
      body: { endDate },
    });
  },
  async cancel(projectId: string, assignmentId: string) {
    await authorizedRequest(`/projects/${projectId}/workforce/${assignmentId}/cancel`, {
      method: 'POST',
    });
  },
};
