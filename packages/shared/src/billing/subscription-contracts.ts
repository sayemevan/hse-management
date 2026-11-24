import { z } from 'zod';

import { REGISTRATION_LIMITS } from '../tenancy/registration-contracts';

/** Subscription lifecycle states (PLT-10). The effective one is computed from dates (T-22). */
export const SUBSCRIPTION_STATES = ['trial', 'active', 'grace', 'read_only'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const PAYMENT_STATUSES = ['pending', 'confirmed', 'rejected', 'withdrawn'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Receipt rules (O-39, PLT-07 category `payment_proof`). */
export const PAYMENT_PROOF_RULES = {
  maxBytes: 10 * 1024 * 1024,
  contentTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
} as const;

export const PAYMENT_LIMITS = {
  /** SAR, excluding nothing: the amount actually transferred (PLT-13). */
  amountMax: 10_000_000,
  referenceMax: 100,
  /** A transfer older than this is refused (PLT-13 validation). */
  transferMaxAgeDays: 60,
  rejectionReasonMin: REGISTRATION_LIMITS.rejectionReasonMin,
  rejectionReasonMax: REGISTRATION_LIMITS.rejectionReasonMax,
} as const;

/** Halalas per riyal: money is stored as integer halalas (PLT-06). */
export const HALALAS_PER_RIYAL = 100;

/** Reminder thresholds in days before a deadline (O-35, PLT-15). */
export const REMINDER_DAYS = {
  trialEnding: [7, 3, 1],
  renewalDue: [14, 7, 1],
  graceEnding: [7, 1],
} as const;

/** The banner shows the trial end from this many days before it (PLT-11 FR-6). */
export const TRIAL_BANNER_DAYS = 7;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;

/** "1234.5" → 123450 halalas; the string form avoids floating-point rounding. */
export function amountToHalalas(amount: string): number {
  const [riyals = '0', fraction = ''] = amount.split('.');
  return Number(riyals) * HALALAS_PER_RIYAL + Number(fraction.padEnd(2, '0'));
}

const amountSchema = z
  .string()
  .trim()
  .regex(AMOUNT, 'invalidAmount')
  .refine((value) => {
    const halalas = amountToHalalas(value);
    return halalas > 0 && halalas <= PAYMENT_LIMITS.amountMax * HALALAS_PER_RIYAL;
  }, 'invalidAmount');

// ---- Requests --------------------------------------------------------------------------

/** Text fields of `POST /subscription/payments` (multipart; the receipt is the `file` part). */
export const submitPaymentFieldsSchema = z.object({
  planCode: z.string().trim().min(1).max(50),
  billingCycle: z.enum(BILLING_CYCLES),
  amount: amountSchema,
  transferredOn: z.string().regex(ISO_DATE, 'invalidDate'),
  reference: z
    .string()
    .trim()
    .max(PAYMENT_LIMITS.referenceMax)
    .transform((value) => (value === '' ? null : value))
    .optional(),
});
export type SubmitPaymentFields = z.input<typeof submitPaymentFieldsSchema>;

export const confirmPaymentRequestSchema = z.object({
  planCode: z.string().trim().min(1).max(50).optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  amountReceived: amountSchema.optional(),
});
export type ConfirmPaymentRequest = z.input<typeof confirmPaymentRequestSchema>;

export const rejectPaymentRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(PAYMENT_LIMITS.rejectionReasonMin)
    .max(PAYMENT_LIMITS.rejectionReasonMax),
});

// ---- Responses -------------------------------------------------------------------------

/** Public part of the subscription, in `GET /tenant` (PLT-11 FR-5). No plan or amounts. */
export interface TenantSubscriptionDto {
  state: SubscriptionState;
  /** Trial end, period end or grace end, depending on the state; null when read-only. */
  endsAt: number | null;
  readOnlySince: number | null;
  paymentUnderReview: boolean;
}

export interface UsageDto {
  users: number;
  projects: number;
  storageBytes: number;
}

export interface LimitsDto {
  users: number | null;
  projects: number | null;
  storageBytes: number;
}

export interface BankDetailsDto {
  bankName: string;
  beneficiary: string;
  iban: string;
}

export interface PaymentDto {
  id: string;
  planCode: string;
  planName: string;
  billingCycle: BillingCycle;
  /** SAR as entered by the company. */
  amount: number;
  transferredOn: string;
  reference: string | null;
  status: PaymentStatus;
  submittedAt: number;
  reviewedAt: number | null;
  rejectionReason: string | null;
  /** What the System Owner confirmed, when confirmed. */
  confirmedPlanName: string | null;
  confirmedBillingCycle: BillingCycle | null;
  confirmedAmount: number | null;
  periodStart: number | null;
  periodEnd: number | null;
}

/** `GET /subscription` (PLT-13 FR-1). */
export interface SubscriptionSummaryDto {
  planCode: string;
  planName: string;
  state: SubscriptionState;
  billingCycle: BillingCycle | null;
  trialEndsAt: number | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  graceEndsAt: number | null;
  readOnlySince: number | null;
  /** Plan of a confirmed period that hasn't started yet. */
  nextPlanName: string | null;
  usage: UsageDto;
  limits: LimitsDto;
  bankDetails: BankDetailsDto;
  pendingPayment: PaymentDto | null;
}

export interface PlatformPaymentSummaryDto {
  id: string;
  companyName: string;
  companySlug: string;
  planName: string;
  billingCycle: BillingCycle;
  amount: number;
  transferredOn: string;
  status: PaymentStatus;
  submittedAt: number;
}

export interface PlatformPaymentDetailDto extends PaymentDto {
  companyName: string;
  companySlug: string;
  contactEmail: string | null;
  contactPhone: string | null;
  submittedByName: string | null;
  reviewedByName: string | null;
  fileName: string;
  fileContentType: string;
  subscription: {
    state: SubscriptionState;
    planCode: string;
    trialEndsAt: number | null;
    currentPeriodEnd: number | null;
    graceEndsAt: number | null;
  };
  usage: UsageDto;
  history: PaymentDto[];
}

export interface PlatformSubscriptionDto {
  companyName: string;
  companySlug: string;
  planName: string;
  state: SubscriptionState;
  billingCycle: BillingCycle | null;
  /** The deadline that matters in this state (trial end, period end, grace end) or null. */
  deadline: number | null;
  readOnlySince: number | null;
  paymentPendingId: string | null;
}

export interface JobRunDto {
  name: string;
  lastRunAt: number | null;
  outcome: 'succeeded' | 'failed' | null;
  processed: number;
  changed: number;
  failed: number;
  error: string | null;
}
