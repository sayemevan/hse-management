import type {
  CompanyInformationDto,
  CompanyProfileDto,
  CompanySettingsDto,
  CompanySettingsRequest,
  LogoDto,
  UpdateCompanyRequest,
} from '@hse/shared';

import { authorizedRequest } from '@/modules/auth/auth-session';

/** Company profile, settings and logo (US-012 – US-015). */
export const companyService = {
  async information(): Promise<CompanyInformationDto> {
    return (await authorizedRequest<CompanyInformationDto>('/company')).data;
  },

  async updateProfile(request: UpdateCompanyRequest): Promise<CompanyProfileDto> {
    return (
      await authorizedRequest<CompanyProfileDto>('/company', { method: 'PATCH', body: request })
    ).data;
  },

  async settings(): Promise<CompanySettingsDto> {
    return (await authorizedRequest<CompanySettingsDto>('/company/settings')).data;
  },

  async updateSettings(request: CompanySettingsRequest): Promise<CompanySettingsDto> {
    return (
      await authorizedRequest<CompanySettingsDto>('/company/settings', {
        method: 'PUT',
        body: request,
      })
    ).data;
  },

  async uploadLogo(file: File): Promise<LogoDto> {
    const form = new FormData();
    form.set('file', file);
    return (await authorizedRequest<LogoDto>('/company/logo', { method: 'PUT', body: form })).data;
  },

  async removeLogo(): Promise<void> {
    await authorizedRequest<null>('/company/logo', { method: 'DELETE' });
  },
};
