import { z } from 'zod';

import { EMAIL_MAX_LENGTH, LANGUAGES } from '../auth/auth-contracts';
import { newPasswordSchema } from '../auth/password-policy';

/**
 * Roles a Company Administrator can give at invitation (O-23): every company-level role
 * of D-02 except System Owner. Rights per role come from the permission matrix (PLT-16).
 */
export const INVITABLE_ROLES = [
  'company_administrator',
  'hse_director',
  'hse_manager',
  'project_manager',
  'safety_officer',
  'site_engineer',
  'supervisor',
  'foreman',
  'inspector',
  'worker',
  'client',
  'consultant',
  'auditor',
] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const USER_LIMITS = {
  fullNameMin: 2,
  fullNameMax: 100,
  searchMax: 100,
} as const;

const emailSchema = z
  .string()
  .trim()
  .min(1)
  .max(EMAIL_MAX_LENGTH)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

export const fullNameSchema = z
  .string()
  .trim()
  .min(USER_LIMITS.fullNameMin)
  .max(USER_LIMITS.fullNameMax);

// ---- Requests --------------------------------------------------------------------------

export const inviteUserRequestSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  roleCode: z.enum(INVITABLE_ROLES),
  language: z.enum(LANGUAGES),
});
export type InviteUserRequest = z.input<typeof inviteUserRequestSchema>;

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPasswordSchema,
});
export type AcceptInvitationRequest = z.input<typeof acceptInvitationRequestSchema>;

export const userListQuerySchema = z.object({
  search: z.string().trim().max(USER_LIMITS.searchMax).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.input<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.input<typeof resetPasswordRequestSchema>;

// ---- Responses -------------------------------------------------------------------------

export type UserListStatus =
  'active' | 'invitation_pending' | 'invitation_expired' | 'suspended' | 'locked';

export interface UserListItemDto {
  id: string;
  fullName: string;
  email: string;
  /** The company role (one per user, O-47). */
  roleCodes: string[];
  /** Project roles in force or scheduled (US-008). */
  projectCount: number;
  status: UserListStatus;
  /** Epoch ms; present for pending invitations. */
  invitationSentAt: number | null;
  invitationExpiresAt: number | null;
  lastLoginAt: number | null;
}

export interface InvitationPreviewDto {
  companyName: string;
  fullName: string;
  email: string;
}

export interface ResetPasswordPreviewDto {
  /** Masked, e.g. `s•••@example.com`. */
  email: string;
}

/** `s•••@example.com` — enough for the user to recognise their address. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return `${email[0]}•••${email.slice(at)}`;
}
