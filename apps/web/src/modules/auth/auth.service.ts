import type {
  AcceptInvitationRequest,
  ChangePasswordRequest,
  CurrentUserDto,
  InvitationPreviewDto,
  Language,
  LoginRequest,
  LoginResponseDto,
  ResetPasswordPreviewDto,
  SessionDto,
  UpdateMeRequest,
} from '@hse/shared';

import { apiRequest } from '@/services/api-client';

import { authorizedRequest, clearAccessToken, setAccessToken } from './auth-session';

/** API calls of the identity module (US-001 – US-007, US-010, PLT-03). */
export const authService = {
  /** US-007 */
  async updateProfile(request: UpdateMeRequest): Promise<CurrentUserDto> {
    return (await authorizedRequest<CurrentUserDto>('/auth/me', { method: 'PATCH', body: request }))
      .data;
  },

  /** US-002: always resolves the same way (T-21). */
  async forgotPassword(email: string): Promise<void> {
    await apiRequest<null>('/auth/forgot-password', { method: 'POST', body: { email } });
  },

  /** US-003: checks the link without using it. */
  async resetPreview(token: string): Promise<ResetPasswordPreviewDto> {
    const path = `/auth/reset-password?token=${encodeURIComponent(token)}`;
    return (await apiRequest<ResetPasswordPreviewDto>(path)).data;
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await apiRequest<{ revokedSessions: number }>('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
    });
  },

  /** US-006: who an invitation is for (changes nothing). */
  async invitationPreview(token: string): Promise<InvitationPreviewDto> {
    const path = `/invitations?token=${encodeURIComponent(token)}`;
    return (await apiRequest<InvitationPreviewDto>(path)).data;
  },

  /** US-006: activates the account and signs in on this device. */
  async acceptInvitation(request: AcceptInvitationRequest): Promise<CurrentUserDto> {
    const response = await apiRequest<LoginResponseDto>('/invitations/accept', {
      method: 'POST',
      body: request,
    });
    setAccessToken(response.data);
    return response.data.user;
  },

  async login(request: LoginRequest): Promise<CurrentUserDto> {
    const response = await apiRequest<LoginResponseDto>('/auth/login', {
      method: 'POST',
      body: request,
    });
    setAccessToken(response.data);
    return response.data.user;
  },

  async logout(): Promise<void> {
    try {
      await apiRequest<null>('/auth/logout', { method: 'POST' });
    } finally {
      // Even offline, this device forgets the session (US-004 error handling).
      clearAccessToken();
    }
  },

  async me(): Promise<CurrentUserDto> {
    return (await authorizedRequest<CurrentUserDto>('/auth/me')).data;
  },

  async setPreferredLanguage(preferredLanguage: Language): Promise<CurrentUserDto> {
    return (
      await authorizedRequest<CurrentUserDto>('/auth/me', {
        method: 'PATCH',
        body: { preferredLanguage },
      })
    ).data;
  },

  async changePassword(request: ChangePasswordRequest): Promise<number> {
    const response = await authorizedRequest<null>('/auth/change-password', {
      method: 'POST',
      body: request,
    });
    return Number(response.meta?.revokedSessions ?? 0);
  },

  async listSessions(): Promise<SessionDto[]> {
    return (await authorizedRequest<SessionDto[]>('/auth/sessions')).data;
  },

  async revokeSession(sessionId: string): Promise<void> {
    await authorizedRequest<null>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  },

  async revokeOtherSessions(): Promise<number> {
    const response = await authorizedRequest<null>('/auth/sessions/revoke-others', {
      method: 'POST',
    });
    return Number(response.meta?.revokedSessions ?? 0);
  },
};
