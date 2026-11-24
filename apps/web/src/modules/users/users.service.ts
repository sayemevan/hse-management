import type { InviteUserRequest, PaginationMeta, UserListItemDto } from '@hse/shared';

import { authorizedRequest } from '@/modules/auth/auth-session';

export interface UserPage {
  items: UserListItemDto[];
  meta: PaginationMeta | undefined;
}

/** The Company Administrator's user list and invitations (US-006). */
export const usersService = {
  async list(search: string, page: number): Promise<UserPage> {
    const query = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (search.trim()) query.set('search', search.trim());
    const response = await authorizedRequest<UserListItemDto[]>(`/users?${query.toString()}`);
    return { items: response.data, meta: response.meta as PaginationMeta | undefined };
  },

  async invite(request: InviteUserRequest): Promise<UserListItemDto> {
    return (
      await authorizedRequest<UserListItemDto>('/users/invitations', {
        method: 'POST',
        body: request,
      })
    ).data;
  },

  async resend(userId: string): Promise<void> {
    await authorizedRequest<null>(`/users/${encodeURIComponent(userId)}/invitation/resend`, {
      method: 'POST',
    });
  },

  async cancel(userId: string): Promise<void> {
    await authorizedRequest<null>(`/users/${encodeURIComponent(userId)}/invitation`, {
      method: 'DELETE',
    });
  },
};
