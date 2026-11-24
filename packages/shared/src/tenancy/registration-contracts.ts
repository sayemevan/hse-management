import { z } from 'zod';

import { EMAIL_MAX_LENGTH, LANGUAGES, type Language } from '../auth/auth-contracts';
import { newPasswordSchema } from '../auth/password-policy';
import { isCountryCode, isTimeZone } from '../geo/countries';
import { phoneSchema } from '../contact/phone';
import { slugSchema } from './slug';

export { normalizePhone, phoneSchema } from '../contact/phone';

/** Field limits for company registration (US-011.1). */
export const REGISTRATION_LIMITS = {
  companyNameMin: 2,
  companyNameMax: 150,
  cityMin: 2,
  cityMax: 100,
  personNameMin: 2,
  personNameMax: 150,
  rejectionReasonMin: 10,
  rejectionReasonMax: 1000,
} as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const emailSchema = z
  .string()
  .trim()
  .min(1)
  .max(EMAIL_MAX_LENGTH)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

/** Fields of an application that can be edited on resubmission (everything except the email). */
const editableFields = {
  companyName: text(REGISTRATION_LIMITS.companyNameMin, REGISTRATION_LIMITS.companyNameMax),
  slug: slugSchema,
  countryCode: z.string().refine(isCountryCode, 'invalidCountry'),
  city: text(REGISTRATION_LIMITS.cityMin, REGISTRATION_LIMITS.cityMax),
  timeZone: z.string().refine(isTimeZone, 'invalidTimeZone'),
  defaultLanguage: z.enum(LANGUAGES),
  applicantName: text(REGISTRATION_LIMITS.personNameMin, REGISTRATION_LIMITS.personNameMax),
  applicantPhone: phoneSchema,
  planCode: z.string().min(1).max(50),
  applicantLanguage: z.enum(LANGUAGES),
  turnstileToken: z.string().min(1).max(4096),
};

export const registrationRequestSchema = z.object({
  ...editableFields,
  applicantEmail: emailSchema,
  password: newPasswordSchema,
  termsAccepted: z.literal(true, { error: 'termsRequired' }),
});
export type RegistrationRequest = z.input<typeof registrationRequestSchema>;

export const resubmissionRequestSchema = z.object({
  ...editableFields,
  token: z.string().min(1).max(200),
  password: newPasswordSchema.optional(),
});
export type ResubmissionRequest = z.input<typeof resubmissionRequestSchema>;

export const verifyEmailRequestSchema = z.object({ token: z.string().min(1).max(200) });
export const resendVerificationRequestSchema = z.object({
  email: emailSchema,
  language: z.enum(LANGUAGES),
});

export const approveRegistrationRequestSchema = z.object({
  phoneConfirmed: z.literal(true, { error: 'phoneConfirmationRequired' }),
  planCode: z.string().min(1).max(50).optional(),
});

export const rejectRegistrationRequestSchema = z.object({
  reason: text(REGISTRATION_LIMITS.rejectionReasonMin, REGISTRATION_LIMITS.rejectionReasonMax),
});

// ---- Responses -------------------------------------------------------------------------

export type SlugUnavailableReason = 'invalid' | 'reserved' | 'taken';

export interface SlugAvailabilityDto {
  slug: string;
  available: boolean;
  reason?: SlugUnavailableReason;
}

export interface PlanDto {
  code: string;
  name: string;
  maxProjects: number | null;
  maxUsers: number | null;
  maxStorageBytes: number;
  /** SAR excluding VAT; null until the price is decided (F-02b). */
  monthlyPrice: number | null;
  annualPrice: number | null;
}

export const REGISTRATION_STATUSES = [
  'pending_email_verification',
  'submitted',
  'rejected',
  'approved',
  'closed',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export interface RegistrationSummaryDto {
  id: string;
  status: RegistrationStatus;
  companyName: string;
  slug: string;
  applicantName: string;
  applicantEmail: string;
  planCode: string;
  submittedAt: number | null;
  createdAt: number;
}

export interface RegistrationReviewDto {
  decision: 'approved' | 'rejected';
  reason: string | null;
  phoneConfirmed: boolean;
  previousPlanCode: string | null;
  newPlanCode: string | null;
  decidedByName: string | null;
  decidedAt: number;
}

export interface RegistrationDetailDto extends RegistrationSummaryDto {
  countryCode: string;
  city: string;
  timeZone: string;
  defaultLanguage: Language;
  applicantPhone: string;
  applicantLanguage: Language;
  emailVerifiedAt: number | null;
  companyId: string | null;
  reviews: RegistrationReviewDto[];
}

export interface ApprovalResultDto {
  companyId: string;
  slug: string;
  signInUrl: string;
}

export interface ResubmissionFormDto {
  companyName: string;
  slug: string;
  countryCode: string;
  city: string;
  timeZone: string;
  defaultLanguage: Language;
  applicantName: string;
  applicantEmail: string;
  applicantPhone: string;
  planCode: string;
  rejectionReason: string;
}
