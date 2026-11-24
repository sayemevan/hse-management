import { z } from 'zod';

import { EMAIL_MAX_LENGTH, LANGUAGES, type Language } from '../auth/auth-contracts';
import { isCountryCode, isTimeZone } from '../geo/countries';
import { phoneSchema } from '../contact/phone';
import { REGISTRATION_LIMITS } from '../tenancy/registration-contracts';
import type { SubscriptionState } from '../billing/subscription-contracts';

/** Company settings (US-013, O-28). */
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const TIME_FORMATS = ['24h', '12h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** Days as in `Date.getDay()`: 0 = Sunday … 6 = Saturday. */
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];
export const WEEK_STARTS = [0, 6, 1] as const satisfies readonly WeekDay[];
export type WeekStart = (typeof WEEK_STARTS)[number];

export const DEFAULT_COMPANY_SETTINGS = {
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  weekStart: 0,
  workingDays: [0, 1, 2, 3, 4],
} as const satisfies Omit<CompanySettingsDto, 'defaultLanguage' | 'updatedAt'>;

export const COMPANY_LIMITS = {
  registrationNumberMax: 50,
  addressMax: 300,
} as const;

/** Logo rules (O-30, PLT-07 category `company_logo`). */
export const LOGO_RULES = {
  maxBytes: 2 * 1024 * 1024,
  contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
} as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

// ---- Requests --------------------------------------------------------------------------

export const updateCompanyRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(REGISTRATION_LIMITS.companyNameMin)
    .max(REGISTRATION_LIMITS.companyNameMax)
    .optional(),
  registrationNumber: optionalText(COMPANY_LIMITS.registrationNumberMax).optional(),
  countryCode: z.string().refine(isCountryCode, 'invalidCountry').optional(),
  city: z
    .string()
    .trim()
    .min(REGISTRATION_LIMITS.cityMin)
    .max(REGISTRATION_LIMITS.cityMax)
    .optional(),
  address: optionalText(COMPANY_LIMITS.addressMax).optional(),
  timeZone: z.string().refine(isTimeZone, 'invalidTimeZone').optional(),
  contactEmail: z
    .string()
    .trim()
    .min(1)
    .max(EMAIL_MAX_LENGTH)
    .pipe(z.email())
    .transform((email) => email.toLowerCase())
    .optional(),
  contactPhone: phoneSchema.optional(),
  /** The `updatedAt` the form loaded (optimistic concurrency, US-012 FR-4). */
  updatedAt: z.number().int(),
});
export type UpdateCompanyRequest = z.input<typeof updateCompanyRequestSchema>;

export const companySettingsRequestSchema = z.object({
  defaultLanguage: z.enum(LANGUAGES),
  dateFormat: z.enum(DATE_FORMATS),
  timeFormat: z.enum(TIME_FORMATS),
  weekStart: z.union(WEEK_STARTS.map((day) => z.literal(day))),
  workingDays: z
    .array(z.union(WEEK_DAYS.map((day) => z.literal(day))))
    .min(1, 'noWorkingDay')
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  updatedAt: z.number().int(),
});
export type CompanySettingsRequest = z.input<typeof companySettingsRequestSchema>;

// ---- Responses -------------------------------------------------------------------------

export interface CompanyProfileDto {
  name: string;
  slug: string;
  registrationNumber: string | null;
  countryCode: string | null;
  city: string | null;
  address: string | null;
  timeZone: string;
  defaultLanguage: Language;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  updatedAt: number;
}

/** Shown only to administrators (US-015 FR-2). */
export interface CompanyAccountDto {
  planCode: string;
  planName: string;
  subscriptionStatus: string;
  trialEndsAt: number | null;
  currentPeriodEnd: number | null;
  users: { used: number; limit: number | null };
  /** Projects not archived (O-52), Sprint 5. */
  projects: { used: number; limit: number | null };
  storage: { usedBytes: number; limitBytes: number };
}

export interface CompanyInformationDto {
  profile: CompanyProfileDto;
  /** For every user (PLT-13 FR-10); null before the company has a subscription. */
  subscription: { planName: string; state: SubscriptionState; endsAt: number | null } | null;
  account?: CompanyAccountDto;
}

export interface CompanySettingsDto {
  defaultLanguage: Language;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  weekStart: WeekStart;
  workingDays: WeekDay[];
  updatedAt: number;
}

export interface LogoDto {
  logoUrl: string | null;
}
