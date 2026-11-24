import type { NotificationOpenDto, NotificationPageDto } from '@hse/shared';

import { authorizedRequest } from '@/modules/auth/auth-session';

/** PLT-17: the signed-in user's own notifications. */
export const notificationsService = {
  async list(options: { unread?: boolean; before?: string | null; limit?: number } = {}) {
    const query = new URLSearchParams({ limit: String(options.limit ?? 25) });
    if (options.unread) query.set('unread', 'true');
    if (options.before) query.set('before', options.before);
    return (await authorizedRequest<NotificationPageDto>(`/notifications?${query.toString()}`))
      .data;
  },

  async unreadCount(): Promise<number> {
    return (await authorizedRequest<{ count: number }>('/notifications/unread-count')).data.count;
  },

  async markRead(id: string): Promise<void> {
    await authorizedRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  },

  async markAllRead(): Promise<void> {
    await authorizedRequest('/notifications/read-all', { method: 'POST' });
  },

  async open(id: string): Promise<NotificationOpenDto> {
    return (
      await authorizedRequest<NotificationOpenDto>(`/notifications/${encodeURIComponent(id)}/open`)
    ).data;
  },
};
