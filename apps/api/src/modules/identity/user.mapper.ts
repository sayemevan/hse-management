import type { CurrentUserDto } from '@hse/shared';

import { loadCompanyPermissions } from './company-permission';
import type { IdentityContext } from './identity.context';
import type { UserRoleRow, UserRow } from './identity.schema';

/** Platform users have no company default; the platform works in Saudi time (O-17). */
const PLATFORM_DEFAULTS = { language: 'en', timeZone: 'Asia/Riyadh' } as const;

/**
 * The signed-in user as the web app sees them (US-001, US-007): effective language and
 * time zone (D-21), company role and permissions (PLT-16) and company settings (US-013).
 */
export async function buildCurrentUser(
  ctx: IdentityContext,
  account: UserRow,
  roles: UserRoleRow[],
): Promise<CurrentUserDto> {
  const company = account.companyId ? await ctx.companies.findById(account.companyId) : undefined;
  const settings = company
    ? await ctx.companySettings.settingsFor(
        company.id,
        company.defaultLanguage,
        company.updatedAt.getTime(),
      )
    : null;

  return {
    id: account.id,
    email: account.email,
    fullName: account.fullName,
    preferredLanguage: account.preferredLanguage,
    timeZone: account.timeZone,
    phone: account.phone,
    companyId: account.companyId,
    roles: roles.map((role) => ({
      roleCode: role.roleCode,
      scopeLevel: role.scopeLevel,
      companyId: role.companyId,
      projectId: role.projectId,
    })),
    effectiveLanguage:
      account.preferredLanguage ?? company?.defaultLanguage ?? PLATFORM_DEFAULTS.language,
    effectiveTimeZone: account.timeZone ?? company?.timeZone ?? PLATFORM_DEFAULTS.timeZone,
    companyRole:
      roles.find((role) => role.scopeLevel === 'company' && role.companyId === account.companyId)
        ?.roleCode ?? null,
    permissions: company
      ? await loadCompanyPermissions(ctx.deps.db, account.id, company.id, ctx.deps.clock)
      : [],
    companySettings: settings,
    lastLoginAt: account.lastLoginAt?.getTime() ?? null,
    workforceMemberId: account.workforceMemberId ?? null,
  };
}
