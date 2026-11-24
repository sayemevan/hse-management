import type {
  Language,
  PlanDto,
  RegistrationRequest,
  ResubmissionFormDto,
  ResubmissionRequest,
  SlugAvailabilityDto,
} from '@hse/shared';

import { apiRequest } from '@/services/api-client';

/** Public API calls of the registration module (US-011.1, 011.2, 011.5; PLT-06). */
export const registrationService = {
  async listPlans(language: Language, signal?: AbortSignal): Promise<PlanDto[]> {
    return (await apiRequest<PlanDto[]>(`/plans?lang=${language}`, { signal })).data;
  },

  async slugAvailability(slug: string, signal?: AbortSignal): Promise<SlugAvailabilityDto> {
    return (
      await apiRequest<SlugAvailabilityDto>(
        `/registrations/slug-availability?slug=${encodeURIComponent(slug)}`,
        { signal },
      )
    ).data;
  },

  async register(request: RegistrationRequest): Promise<void> {
    await apiRequest<{ email: string }>('/registrations', { method: 'POST', body: request });
  },

  async verifyEmail(token: string): Promise<void> {
    await apiRequest<{ status: 'submitted' }>('/registrations/verify-email', {
      method: 'POST',
      body: { token },
    });
  },

  async resendVerification(email: string, language: Language): Promise<void> {
    await apiRequest<null>('/registrations/resend-verification', {
      method: 'POST',
      body: { email, language },
    });
  },

  async resubmissionForm(token: string, signal?: AbortSignal): Promise<ResubmissionFormDto> {
    return (
      await apiRequest<ResubmissionFormDto>(
        `/registrations/resubmission?token=${encodeURIComponent(token)}`,
        { signal },
      )
    ).data;
  },

  async resubmit(request: ResubmissionRequest): Promise<void> {
    await apiRequest<{ status: 'submitted' }>('/registrations/resubmission', {
      method: 'PUT',
      body: request,
    });
  },
};

/**
 * The address shown on "Check your email". Kept in sessionStorage (not the URL) so the
 * applicant's email never ends up in browser history or server logs.
 */
const PENDING_EMAIL_KEY = 'hse-registration-email';

export function rememberPendingEmail(email: string): void {
  try {
    sessionStorage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    // Storage can be unavailable (private mode); the page then asks for the address.
  }
}

export function pendingEmail(): string | null {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}
