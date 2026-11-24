import { z } from 'zod';

import { isCountryCode } from '../geo/countries';

/** Project statuses (D-13). */
export const PROJECT_STATUSES = [
  'planning',
  'mobilization',
  'active',
  'on_hold',
  'completed',
  'archived',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Statuses a new project can start in (US-016). */
export const INITIAL_PROJECT_STATUSES = ['planning', 'mobilization', 'active'] as const;

/**
 * O-50: only Mobilization and Active projects accept new operational records. Every later
 * module uses this one rule.
 */
export function acceptsRecords(status: ProjectStatus): boolean {
  return status === 'mobilization' || status === 'active';
}

/**
 * Allowed status changes (O-49, US-017 FR-2). On Hold returns to the status it was held from,
 * so it isn't listed here; archive and restore are separate actions (US-018).
 */
const TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  planning: ['mobilization', 'active'],
  mobilization: ['active', 'on_hold'],
  active: ['on_hold', 'completed'],
  on_hold: [],
  completed: ['active'],
  archived: [],
};

/** The statuses a project can move to now. */
export function nextProjectStatuses(
  status: ProjectStatus,
  statusBeforeHold: ProjectStatus | null,
): ProjectStatus[] {
  if (status === 'on_hold') return statusBeforeHold ? [statusBeforeHold] : ['active'];
  return [...TRANSITIONS[status]];
}

export const PROJECT_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  codeMin: 2,
  codeMax: 20,
  clientMin: 2,
  clientMax: 120,
  contractMax: 60,
  descriptionMax: 2000,
  cityMax: 80,
  noteMax: 500,
  searchMax: 100,
} as const;

/** O-51: capital letters, numbers and hyphens. Lower case is accepted and stored in capitals. */
export const PROJECT_CODE_PATTERN = /^[A-Z0-9-]+$/;

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidDate')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'invalidDate');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const projectCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .min(PROJECT_LIMITS.codeMin)
      .max(PROJECT_LIMITS.codeMax)
      .regex(PROJECT_CODE_PATTERN, 'invalidProjectCode'),
  );

const projectFields = {
  name: z.string().trim().min(PROJECT_LIMITS.nameMin).max(PROJECT_LIMITS.nameMax),
  code: projectCodeSchema,
  clientName: z.string().trim().min(PROJECT_LIMITS.clientMin).max(PROJECT_LIMITS.clientMax),
  contractNumber: optionalText(PROJECT_LIMITS.contractMax),
  description: optionalText(PROJECT_LIMITS.descriptionMax),
  city: optionalText(PROJECT_LIMITS.cityMax),
  countryCode: z.string().refine(isCountryCode, 'invalidCountry'),
  startDate: isoDateSchema,
  expectedEndDate: isoDateSchema.nullable().optional(),
};

const endNotBeforeStart = (value: { startDate?: string; expectedEndDate?: string | null }) =>
  !value.startDate || !value.expectedEndDate || value.expectedEndDate >= value.startDate;

export const createProjectRequestSchema = z
  .object({ ...projectFields, status: z.enum(INITIAL_PROJECT_STATUSES).default('planning') })
  .refine(endNotBeforeStart, { path: ['expectedEndDate'], message: 'endBeforeStart' });
export type CreateProjectRequest = z.input<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z
  .object({ version: z.number().int().min(0), ...projectFields })
  .partial({
    name: true,
    code: true,
    clientName: true,
    contractNumber: true,
    description: true,
    city: true,
    countryCode: true,
    startDate: true,
    expectedEndDate: true,
  })
  .refine(endNotBeforeStart, { path: ['expectedEndDate'], message: 'endBeforeStart' });
export type UpdateProjectRequest = z.input<typeof updateProjectRequestSchema>;

export const changeProjectStatusRequestSchema = z.object({
  version: z.number().int().min(0),
  status: z.enum(PROJECT_STATUSES),
  note: optionalText(PROJECT_LIMITS.noteMax),
});
export type ChangeProjectStatusRequest = z.input<typeof changeProjectStatusRequestSchema>;

export const projectVersionRequestSchema = z.object({ version: z.number().int().min(0) });

const statusList = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(',').filter(Boolean) : []))
  .pipe(z.array(z.enum(PROJECT_STATUSES)));

export const projectListQuerySchema = z.object({
  search: z.string().trim().max(PROJECT_LIMITS.searchMax).optional(),
  status: statusList,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ---- Responses -------------------------------------------------------------------------

export interface ProjectListItemDto {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: ProjectStatus;
  startDate: string;
  expectedEndDate: string | null;
}

export interface ProjectDto extends ProjectListItemDto {
  contractNumber: string | null;
  description: string | null;
  city: string | null;
  countryCode: string;
  statusBeforeHold: ProjectStatus | null;
  statusBeforeArchive: ProjectStatus | null;
  statusChangedAt: number;
  archivedAt: number | null;
  archivedByName: string | null;
  createdAt: number;
  /** Epoch ms of the last change; send it back on every write (optimistic concurrency). */
  version: number;
  acceptsRecords: boolean;
  /** Code can be changed only in Planning (O-51). */
  codeEditable: boolean;
  allowedNextStatuses: ProjectStatus[];
  /** The caller's project-scope permissions (T-37), for showing actions only. */
  myPermissions: string[];
  /** PLT-19 FR-6: active places and members in force. */
  counts: { areas: number; locations: number; workZones: number; members: number };
}
