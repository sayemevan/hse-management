import { z } from 'zod';

import type { TenantSubscriptionDto } from '../billing/subscription-contracts';
import type { CompanySettingsDto } from '../company/company-contracts';
import { isTimeZone } from '../geo/countries';
import { phoneSchema } from '../contact/phone';
import { PASSWORD_POLICY, newPasswordSchema } from './password-policy';

/** Supported interface languages (D-14). */
export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

export const EMAIL_MAX_LENGTH = 254;

const emailSchema = z
  .string()
  .trim()
  .min(1)
  .max(EMAIL_MAX_LENGTH)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

// ---- Requests --------------------------------------------------------------------------

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_POLICY.maxLength),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_POLICY.maxLength),
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.input<typeof changePasswordRequestSchema>;

/** US-007 (O-27): own name, phone, language and time zone. `null` = follow the company default. */
export const updateMeRequestSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    phone: z
      .union([z.literal(''), phoneSchema])
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    preferredLanguage: z.enum(LANGUAGES).nullable().optional(),
    timeZone: z.string().refine(isTimeZone, 'invalidTimeZone').nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'empty');
export type UpdateMeRequest = z.input<typeof updateMeRequestSchema>;

// ---- Responses -------------------------------------------------------------------------

export interface RoleAssignmentDto {
  roleCode: string;
  scopeLevel: 'platform' | 'company' | 'project';
  companyId: string | null;
  projectId: string | null;
}

export interface CurrentUserDto {
  id: string;
  email: string;
  fullName: string;
  preferredLanguage: Language | null;
  timeZone: string | null;
  phone: string | null;
  companyId: string | null;
  roles: RoleAssignmentDto[];
  /** The user's one company role (O-47); null for platform users. */
  companyRole: string | null;
  /** Language and time zone after applying the company default (D-21). */
  effectiveLanguage: Language;
  effectiveTimeZone: string;
  /** Company-scope permissions (PLT-16), for showing menus. The server still checks. */
  permissions: string[];
  /** Company preferences for formatting dates and times (US-013); null for platform users. */
  companySettings: CompanySettingsDto | null;
  lastLoginAt: number | null;
  /** The linked workforce profile (D-09, O-85), for the My workforce record menu item. */
  workforceMemberId: string | null;
}

export interface AccessTokenDto {
  accessToken: string;
  /** Epoch milliseconds (UTC). */
  accessTokenExpiresAt: number;
}

export interface LoginResponseDto extends AccessTokenDto {
  user: CurrentUserDto;
}

export interface SessionDto {
  id: string;
  deviceLabel: string;
  browser: string;
  ipAddress: string | null;
  createdAt: number;
  lastActivityAt: number;
  isCurrent: boolean;
}

export interface TenantDto {
  context: 'platform' | 'company';
  company?: {
    name: string;
    logoUrl: string | null;
    defaultLanguage: Language;
    /** IANA time zone, used when the user has none set (PLT-03). */
    timeZone: string;
    /** Subscription state for the banner (PLT-11 FR-5). */
    subscription: TenantSubscriptionDto | null;
  };
}
