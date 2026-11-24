import { z } from 'zod';

import { phoneSchema } from '../contact/phone';
import { isCountryCode } from '../geo/countries';
import { isoDateSchema } from '../projects/project-contracts';
import type { ExpiryState } from './workforce-rules';

/**
 * Workforce (Sprint 7: US-024 – US-030, PLT-20, PLT-21; D-49, D-50). One profile per person for
 * every category (T-47); records are never deleted (T-48).
 */

// ---- Fixed lists ----------------------------------------------------------------------

/** Doc 09 §2. */
export const WORKFORCE_CATEGORIES = [
  'employee',
  'contractor',
  'subcontractor',
  'temporary_worker',
  'visitor',
  'consultant',
  'client_representative',
] as const;
export type WorkforceCategory = (typeof WORKFORCE_CATEGORIES)[number];

/** Doc 09 §4. Separate from the user's account status (C-19). */
export const WORKFORCE_STATUSES = [
  'active',
  'on_leave',
  'suspended',
  'inactive',
  'terminated',
] as const;
export type WorkforceStatus = (typeof WORKFORCE_STATUSES)[number];

/** O-78: only these statuses can receive new project assignments. */
export const ASSIGNABLE_STATUSES: readonly WorkforceStatus[] = ['active', 'on_leave'];
/** O-78: setting one of these offers to end current and cancel upcoming assignments. */
export const LEAVING_STATUSES: readonly WorkforceStatus[] = ['inactive', 'terminated'];

/** PLT-21. */
export const WORKFORCE_LISTS = ['job_position', 'competency'] as const;
export type WorkforceList = (typeof WORKFORCE_LISTS)[number];

/** T-54: seeded items per list (Doc 09 §6, §7). The key is also the translation key. */
export const WORKFORCE_LIST_SEEDS: Readonly<
  Record<WorkforceList, readonly { key: string; name: string }[]>
> = {
  job_position: [
    { key: 'safety_officer', name: 'Safety Officer' },
    { key: 'hse_manager', name: 'HSE Manager' },
    { key: 'site_engineer', name: 'Site Engineer' },
    { key: 'electrician', name: 'Electrician' },
    { key: 'welder', name: 'Welder' },
    { key: 'rigger', name: 'Rigger' },
    { key: 'scaffolder', name: 'Scaffolder' },
    { key: 'crane_operator', name: 'Crane Operator' },
    { key: 'carpenter', name: 'Carpenter' },
    { key: 'driver', name: 'Driver' },
  ],
  competency: [
    { key: 'working_at_height', name: 'Working at Height' },
    { key: 'first_aid', name: 'First Aid' },
    { key: 'fire_fighting', name: 'Fire Fighting' },
    { key: 'rigging', name: 'Rigging' },
    { key: 'lifting_operations', name: 'Lifting Operations' },
    { key: 'confined_space_entry', name: 'Confined Space Entry' },
  ],
};

/** Dated records kept with history (T-48). */
export const RECORD_KINDS = ['training', 'certificate', 'medical', 'document'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** URL segment of each kind: `/workforce/{id}/trainings`, … */
export const RECORD_KIND_PATHS: Readonly<Record<RecordKind, string>> = {
  training: 'trainings',
  certificate: 'certificates',
  medical: 'medical',
  document: 'documents',
};

/** O-88. */
export const CERTIFICATE_TYPES = [
  'safety_passport',
  'equipment_licence',
  'operator_licence',
  'specialised_training',
  'other',
] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

/** O-87. */
export const DOCUMENT_TYPES = [
  'passport',
  'national_id',
  'residence_permit',
  'work_permit',
  'employment_contract',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPES_REQUIRING_NUMBER: readonly DocumentType[] = [
  'passport',
  'national_id',
  'residence_permit',
];
export const DOCUMENT_TYPES_REQUIRING_EXPIRY: readonly DocumentType[] = [
  'passport',
  'residence_permit',
  'work_permit',
];

/** O-86. */
export const MEDICAL_FITNESS = ['fit', 'fit_with_restrictions', 'unfit'] as const;
export type MedicalFitness = (typeof MEDICAL_FITNESS)[number];

/** US-029. */
export const CONTACT_RELATIONSHIPS = [
  'spouse',
  'parent',
  'child',
  'sibling',
  'relative',
  'friend',
  'colleague',
  'other',
] as const;
export type ContactRelationship = (typeof CONTACT_RELATIONSHIPS)[number];

export const WORKFORCE_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  employeeIdMax: 30,
  employerMax: 120,
  departmentMax: 80,
  reasonMax: 200,
  noteMax: 200,
  /** O-72. */
  profilesMax: 20_000,
  /** O-89. */
  contactsMax: 3,
  /** PLT-21. */
  listItemsMax: 300,
  listNameMin: 2,
  listNameMax: 80,
  /** O-92. */
  bulkAssignMax: 50,
  recordNameMax: 120,
  issuerMax: 120,
  numberMax: 60,
  documentNumberMin: 3,
  documentNumberMax: 30,
  referenceMax: 60,
  restrictionMin: 3,
  restrictionMax: 200,
  voidReasonMin: 5,
  voidReasonMax: 200,
  searchMax: 100,
  pageSize: 25,
} as const;

/** O-71 (answers Q-31 for workforce files). */
export const WORKFORCE_PHOTO_RULES = {
  maxBytes: 5 * 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;
export const WORKFORCE_FILE_RULES = {
  maxBytes: 10 * 1024 * 1024,
  contentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
} as const;

export const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9/-]+$/;
export const DOCUMENT_NUMBER_PATTERN = /^[A-Za-z0-9-]+$/;

/** Unique keys ignore case and surrounding spaces. */
export function workforceKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en');
}

// ---- Field schemas --------------------------------------------------------------------

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, ' '))
    .pipe(z.string().min(min).max(max));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const optionalMinText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, ' '))
    .pipe(z.string().refine((value) => value === '' || value.length >= min, 'tooShort'))
    .pipe(z.string().max(max))
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const countrySchema = z.string().trim().toUpperCase().refine(isCountryCode, 'invalidCountry');

const optionalPhone = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .pipe(phoneSchema.nullable())
  .nullable()
  .optional();

const optionalEmail = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value.toLowerCase()))
  .pipe(z.email().nullable())
  .nullable()
  .optional();

const employeeIdSchema = z
  .string()
  .trim()
  .max(WORKFORCE_LIMITS.employeeIdMax)
  .refine((value) => value === '' || EMPLOYEE_ID_PATTERN.test(value), 'invalidEmployeeId')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

// ---- Profiles (US-024) ----------------------------------------------------------------

export const createWorkforceMemberRequestSchema = z.object({
  category: z.enum(WORKFORCE_CATEGORIES),
  fullName: text(WORKFORCE_LIMITS.nameMin, WORKFORCE_LIMITS.nameMax),
  altName: optionalMinText(WORKFORCE_LIMITS.nameMin, WORKFORCE_LIMITS.nameMax),
  employeeId: employeeIdSchema,
  nationality: countrySchema,
  employer: text(WORKFORCE_LIMITS.nameMin, WORKFORCE_LIMITS.employerMax),
  jobPositionId: z.uuid(),
  department: optionalText(WORKFORCE_LIMITS.departmentMax),
  mobile: optionalPhone,
  email: optionalEmail,
});
export type CreateWorkforceMemberRequest = z.input<typeof createWorkforceMemberRequestSchema>;

export const updateWorkforceMemberRequestSchema = createWorkforceMemberRequestSchema.partial();
export type UpdateWorkforceMemberRequest = z.input<typeof updateWorkforceMemberRequestSchema>;

export const workforceStatusRequestSchema = z.object({
  status: z.enum(WORKFORCE_STATUSES),
  since: isoDateSchema,
  reason: optionalText(WORKFORCE_LIMITS.reasonMax),
  /** O-78: end current and cancel upcoming assignments (Inactive, Terminated). */
  endAssignments: z.boolean().default(true),
});
export type WorkforceStatusRequest = z.input<typeof workforceStatusRequestSchema>;

export const workforceUserLinkRequestSchema = z.object({ userId: z.uuid() });

const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

export const workforceListQuerySchema = z.object({
  search: z.string().trim().max(WORKFORCE_LIMITS.searchMax).optional(),
  status: z.enum(WORKFORCE_STATUSES).optional(),
  category: z.enum(WORKFORCE_CATEGORIES).optional(),
  position: z.uuid().optional(),
  nationality: z.string().trim().toUpperCase().length(2).optional(),
  project: z.uuid().optional(),
  attention: booleanQuery,
  archived: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
});

export const workforceSuggestionQuerySchema = z.object({
  field: z.enum(['employer', 'department', 'training']),
  q: z.string().trim().max(WORKFORCE_LIMITS.searchMax).default(''),
});

export const workforceHistoryQuerySchema = z.object({
  before: z
    .string()
    .regex(/^\d+_[0-9a-f-]{36}$/)
    .optional(),
});

// ---- Lists (PLT-21) -------------------------------------------------------------------

export const workforceListItemRequestSchema = z.object({
  name: text(WORKFORCE_LIMITS.listNameMin, WORKFORCE_LIMITS.listNameMax),
});
export type WorkforceListItemRequest = z.input<typeof workforceListItemRequestSchema>;

export const workforceListQueryParamsSchema = z.object({ includeInactive: booleanQuery });

// ---- Assignments (US-025) -------------------------------------------------------------

export const ASSIGNMENT_STATES = ['upcoming', 'current', 'ended', 'cancelled'] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export const assignWorkforceRequestSchema = z
  .object({
    memberIds: z.array(z.uuid()).min(1).max(WORKFORCE_LIMITS.bulkAssignMax),
    /** `own`: each person's own job position (US-025 flow 2). */
    positionId: z.union([z.uuid(), z.literal('own')]),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable().optional(),
    note: optionalText(WORKFORCE_LIMITS.noteMax),
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    path: ['endDate'],
    message: 'endBeforeStart',
  });
export type AssignWorkforceRequest = z.input<typeof assignWorkforceRequestSchema>;

export const updateAssignmentRequestSchema = z.object({
  positionId: z.uuid().optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.nullable().optional(),
  note: optionalText(WORKFORCE_LIMITS.noteMax),
});
export type UpdateAssignmentRequest = z.input<typeof updateAssignmentRequestSchema>;

export const endAssignmentRequestSchema = z.object({ endDate: isoDateSchema });

export const projectWorkforceQuerySchema = z.object({
  search: z.string().trim().max(WORKFORCE_LIMITS.searchMax).optional(),
  state: z.enum(['current', 'upcoming', 'ended', 'all']).default('current'),
  position: z.uuid().optional(),
  attention: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
});

export const workforceCandidatesQuerySchema = z.object({
  search: z.string().trim().max(WORKFORCE_LIMITS.searchMax).optional(),
});

// ---- Records (US-026 – US-028, US-030) ------------------------------------------------

const trainingFields = z.object({
  name: text(WORKFORCE_LIMITS.nameMin, WORKFORCE_LIMITS.recordNameMax),
  competencyId: z.uuid().nullable().optional(),
  issuer: optionalText(WORKFORCE_LIMITS.issuerMax),
  issuedOn: isoDateSchema,
  expiresOn: isoDateSchema.nullable().optional(),
  reference: optionalText(WORKFORCE_LIMITS.referenceMax),
  note: optionalText(WORKFORCE_LIMITS.noteMax),
});

const certificateFields = z.object({
  type: z.enum(CERTIFICATE_TYPES),
  name: optionalMinText(WORKFORCE_LIMITS.nameMin, WORKFORCE_LIMITS.recordNameMax),
  competencyId: z.uuid().nullable().optional(),
  number: optionalText(WORKFORCE_LIMITS.numberMax),
  issuer: optionalText(WORKFORCE_LIMITS.issuerMax),
  issuedOn: isoDateSchema,
  expiresOn: isoDateSchema.nullable().optional(),
  noExpiry: z.boolean().default(false),
  note: optionalText(WORKFORCE_LIMITS.noteMax),
});

const medicalFields = z.object({
  type: z.enum(MEDICAL_FITNESS),
  issuedOn: isoDateSchema,
  expiresOn: isoDateSchema.nullable().optional(),
  issuer: optionalText(WORKFORCE_LIMITS.issuerMax),
  restrictionNote: optionalText(WORKFORCE_LIMITS.restrictionMax),
  note: optionalText(WORKFORCE_LIMITS.noteMax),
});

const documentNumber = z
  .string()
  .trim()
  .max(WORKFORCE_LIMITS.documentNumberMax)
  .refine(
    (value) =>
      value === '' ||
      (value.length >= WORKFORCE_LIMITS.documentNumberMin && DOCUMENT_NUMBER_PATTERN.test(value)),
    'invalidDocumentNumber',
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

const documentFields = z.object({
  type: z.enum(DOCUMENT_TYPES),
  name: optionalMinText(WORKFORCE_LIMITS.nameMin, WORKFORCE_LIMITS.recordNameMax),
  number: documentNumber,
  country: countrySchema.nullable().optional(),
  issuedOn: isoDateSchema.nullable().optional(),
  expiresOn: isoDateSchema.nullable().optional(),
  note: optionalText(WORKFORCE_LIMITS.noteMax),
});

interface DatedRecord {
  issuedOn?: string | null;
  expiresOn?: string | null;
}
const expiryAfterIssue = (value: DatedRecord) =>
  !value.expiresOn || !value.issuedOn || value.expiresOn > value.issuedOn;

/**
 * Per kind, the fields of a create (and of a renewal). `today` is checked by the service
 * (dates not in the future), since it depends on the company's time zone.
 */
export const recordRequestSchemas = {
  training: trainingFields.refine(expiryAfterIssue, {
    path: ['expiresOn'],
    message: 'expiryBeforeIssue',
  }),
  certificate: certificateFields
    .refine(expiryAfterIssue, { path: ['expiresOn'], message: 'expiryBeforeIssue' })
    .refine((value) => value.type !== 'other' || Boolean(value.name), {
      path: ['name'],
      message: 'required',
    })
    .refine((value) => value.noExpiry !== Boolean(value.expiresOn), {
      path: ['expiresOn'],
      message: 'expiryOrNoExpiry',
    }),
  medical: medicalFields
    .refine(expiryAfterIssue, { path: ['expiresOn'], message: 'expiryBeforeIssue' })
    .refine((value) => (value.type === 'unfit') !== Boolean(value.expiresOn), {
      path: ['expiresOn'],
      message: 'medicalValidUntil',
    })
    .refine(
      (value) =>
        value.type === 'fit_with_restrictions'
          ? (value.restrictionNote?.length ?? 0) >= WORKFORCE_LIMITS.restrictionMin
          : !value.restrictionNote,
      { path: ['restrictionNote'], message: 'restrictionNote' },
    ),
  document: documentFields
    .refine(expiryAfterIssue, { path: ['expiresOn'], message: 'expiryBeforeIssue' })
    .refine((value) => value.type !== 'other' || Boolean(value.name), {
      path: ['name'],
      message: 'required',
    })
    .refine(
      (value) => !DOCUMENT_TYPES_REQUIRING_NUMBER.includes(value.type) || Boolean(value.number),
      {
        path: ['number'],
        message: 'required',
      },
    )
    .refine((value) => value.type !== 'passport' || Boolean(value.country), {
      path: ['country'],
      message: 'required',
    })
    .refine(
      (value) => !DOCUMENT_TYPES_REQUIRING_EXPIRY.includes(value.type) || Boolean(value.expiresOn),
      { path: ['expiresOn'], message: 'required' },
    ),
} as const;

/** Multipart body: `data` (JSON of the fields) and an optional `file`. */
export const recordFormMetaSchema = z.object({
  /** Edit only: remove the stored copy. */
  removeFile: z.boolean().optional(),
});

export const voidRecordRequestSchema = z.object({
  reason: text(WORKFORCE_LIMITS.voidReasonMin, WORKFORCE_LIMITS.voidReasonMax),
});

export const recordListQuerySchema = z.object({
  include: z.enum(['history']).optional(),
});

// ---- Emergency contacts (US-029) ------------------------------------------------------

export const emergencyContactSchema = z
  .object({
    name: text(WORKFORCE_LIMITS.nameMin, WORKFORCE_LIMITS.nameMax),
    relationship: z.enum(CONTACT_RELATIONSHIPS),
    phone: phoneSchema,
    phoneAlt: optionalPhone,
  })
  .refine((value) => !value.phoneAlt || value.phoneAlt !== value.phone, {
    path: ['phoneAlt'],
    message: 'samePhone',
  });

export const emergencyContactsRequestSchema = z.object({
  // More than 3 is refused by the service (WORKFORCE_CONTACT_LIMIT); 10 guards the body size.
  items: z.array(emergencyContactSchema).max(10),
});
export type EmergencyContactsRequest = z.input<typeof emergencyContactsRequestSchema>;

// ---- Responses ------------------------------------------------------------------------

export interface WorkforceListItemDto {
  id: string;
  list: WorkforceList;
  name: string;
  /** Seeded items keep this until renamed; the web app shows the translation (T-54). */
  seedKey: string | null;
  active: boolean;
  position: number;
  /** How many records use it (list managers only). */
  usage?: number;
}

export interface WorkforceListDto {
  items: WorkforceListItemDto[];
}

export type ComplianceBadge = 'ok' | 'expiring' | 'expired' | 'check';

/** PLT-20: computed per request from current records (T-50). */
export interface ComplianceSummaryDto {
  badge: ComplianceBadge;
  worst: 'ok' | 'expiring' | 'expired';
  expired: number;
  expiring: number;
  medicalMissing: boolean;
  medicalUnfit: boolean;
  /** Only for readers with `workforce.contacts.view`. */
  noEmergencyContact?: boolean;
  nearest: { kind: RecordKind; name: string; type: string | null; expiresOn: string } | null;
}

export interface ListItemRefDto {
  id: string;
  name: string;
  seedKey: string | null;
}

export interface WorkforceRowDto {
  id: string;
  fullName: string;
  altName: string | null;
  employeeId: string | null;
  category: WorkforceCategory;
  position: ListItemRefDto | null;
  employer: string;
  status: WorkforceStatus;
  photoUrl: string | null;
  archived: boolean;
  compliance: ComplianceSummaryDto;
  currentProjects: { id: string; code: string }[];
}

export interface WorkforcePageDto {
  items: WorkforceRowDto[];
  page: number;
  total: number;
  pageSize: number;
}

export interface WorkforceDuplicatesDto {
  duplicates: { id: string; fullName: string; position: ListItemRefDto | null; employer: string }[];
}

export interface WorkforceSummaryDto {
  total: number;
  active: number;
  needsAttention: number;
}

export interface MedicalStatusDto {
  fitness: MedicalFitness | null;
  /** `expired` when the latest Fit check passed its date. */
  expiryState: ExpiryState;
  expiresOn: string | null;
  hasRestrictions: boolean;
}

export interface WorkforceCanDto {
  /** `workforce.manage` (archive and restore). */
  manage: boolean;
  edit: boolean;
  viewContacts: boolean;
  editContacts: boolean;
  viewPersonal: boolean;
  editPersonal: boolean;
  linkUser: boolean;
  /** The reader is the linked user (O-85). */
  own: boolean;
}

export interface WorkforceMemberDto extends WorkforceRowDto {
  nationality: string;
  department: string | null;
  mobile: string | null;
  email: string | null;
  statusSince: string;
  statusReason: string | null;
  createdAt: number;
  medical: MedicalStatusDto;
  linkedUser: { id: string; fullName: string } | null;
  currentAssignments: AssignmentDto[];
  can: WorkforceCanDto;
}

export interface AssignmentDto {
  id: string;
  project: { id: string; code: string; name: string };
  position: ListItemRefDto | null;
  startDate: string;
  endDate: string | null;
  note: string | null;
  state: AssignmentState;
}

export interface AssignmentListDto {
  items: AssignmentDto[];
}

export interface ProjectWorkforceRowDto {
  assignmentId: string;
  member: {
    id: string;
    fullName: string;
    altName: string | null;
    employeeId: string | null;
    photoUrl: string | null;
    status: WorkforceStatus;
    compliance: ComplianceSummaryDto;
  };
  position: ListItemRefDto | null;
  startDate: string;
  endDate: string | null;
  note: string | null;
  state: AssignmentState;
}

export interface ProjectWorkforcePageDto {
  items: ProjectWorkforceRowDto[];
  page: number;
  total: number;
  pageSize: number;
  /** Assign people is offered (project not Completed or Archived, caller may manage). */
  canAssign: boolean;
  canManage: boolean;
  /** The caller can open profiles (`workforce.view`). */
  canOpenProfiles: boolean;
}

export interface WorkforceCandidateDto {
  id: string;
  fullName: string;
  altName: string | null;
  employeeId: string | null;
  position: ListItemRefDto | null;
  employer: string;
  status: WorkforceStatus;
  compliance: ComplianceSummaryDto;
  onProject: boolean;
}

export interface WorkforceCandidatesDto {
  items: WorkforceCandidateDto[];
}

export type RecordState = 'current' | 'replaced' | 'voided';

export interface WorkforceRecordDto {
  id: string;
  kind: RecordKind;
  /** Certificate or document type, or the medical fitness result. */
  type: string | null;
  name: string | null;
  competency: ListItemRefDto | null;
  /** Documents: masked to the last 4 characters in lists (US-030 FR-1). */
  number: string | null;
  issuer: string | null;
  country: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  noExpiry: boolean;
  expiryState: ExpiryState;
  reference: string | null;
  /** Medical: only for readers with `workforce.personal.view`. */
  restrictionNote: string | null;
  note: string | null;
  hasFile: boolean;
  fileName: string | null;
  state: RecordState;
  replacesId: string | null;
  replacedById: string | null;
  voidReason: string | null;
  createdAt: number;
}

export interface WorkforceRecordListDto {
  items: WorkforceRecordDto[];
  /** Medical only: the current status (US-028). */
  status?: MedicalStatusDto;
}

export interface EmergencyContactDto {
  name: string;
  relationship: ContactRelationship;
  phone: string;
  phoneAlt: string | null;
  position: number;
}

export interface EmergencyContactsDto {
  items: EmergencyContactDto[];
}

export interface MyWorkforceDto {
  member: WorkforceMemberDto;
}

export interface WorkforceSuggestionsDto {
  items: string[];
}
