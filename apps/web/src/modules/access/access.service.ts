import type {
  AddProjectRoleRequest,
  CompanyRole,
  RoleDetailDto,
  RoleSummaryDto,
  UpdateProjectRoleRequest,
  UserDetailDto,
} from '@hse/shared';

import { authorizedRequest } from '@/modules/auth/auth-session';

const user = (id: string, suffix = '') => `/users/${encodeURIComponent(id)}${suffix}`;

/** US-008 (a user's roles) and US-009 (roles and their permissions). */
export const accessService = {
  async user(id: string): Promise<UserDetailDto> {
    return (await authorizedRequest<UserDetailDto>(user(id))).data;
  },

  async changeCompanyRole(id: string, roleCode: CompanyRole): Promise<UserDetailDto> {
    return (
      await authorizedRequest<UserDetailDto>(user(id, '/company-role'), {
        method: 'PUT',
        body: { roleCode },
      })
    ).data;
  },

  async addProjectRole(id: string, request: AddProjectRoleRequest): Promise<UserDetailDto> {
    return (
      await authorizedRequest<UserDetailDto>(user(id, '/project-roles'), {
        method: 'POST',
        body: request,
      })
    ).data;
  },

  async updateProjectRole(
    id: string,
    assignmentId: string,
    request: UpdateProjectRoleRequest,
  ): Promise<UserDetailDto> {
    return (
      await authorizedRequest<UserDetailDto>(
        user(id, `/project-roles/${encodeURIComponent(assignmentId)}`),
        { method: 'PATCH', body: request },
      )
    ).data;
  },

  async removeProjectRole(id: string, assignmentId: string): Promise<void> {
    await authorizedRequest<null>(user(id, `/project-roles/${encodeURIComponent(assignmentId)}`), {
      method: 'DELETE',
    });
  },

  async roles(): Promise<RoleSummaryDto[]> {
    return (await authorizedRequest<RoleSummaryDto[]>('/roles')).data;
  },

  async role(code: string): Promise<RoleDetailDto> {
    return (await authorizedRequest<RoleDetailDto>(`/roles/${encodeURIComponent(code)}`)).data;
  },

  async saveRole(code: string, version: number, granted: string[]): Promise<RoleDetailDto> {
    return (
      await authorizedRequest<RoleDetailDto>(`/roles/${encodeURIComponent(code)}/permissions`, {
        method: 'PUT',
        body: { version, granted },
      })
    ).data;
  },

  async resetRole(code: string, version: number): Promise<RoleDetailDto> {
    return (
      await authorizedRequest<RoleDetailDto>(
        `/roles/${encodeURIComponent(code)}/permissions/reset`,
        { method: 'POST', body: { version } },
      )
    ).data;
  },
};
