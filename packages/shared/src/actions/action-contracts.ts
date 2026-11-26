import { z } from 'zod';

import { daysBetween } from '../workforce/workforce-rules';

/**
 * The action engine (Sprint 8: PLT-23, US-053 – US-058; D-52, D-53). One engine for every
 * source module (T-57). Statuses are the D-12 list (O-96); a Voided flag covers mistakes
 * (O-106).
 */
export const ACTION_STATUSES = ['open', 'in_progress', 'completed', 'verified', 'closed'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** O-99: the six Doc 13 §4 types, fixed in Phase 1. */
export const ACTION_TYPES = [
  'corrective',
  'preventive',
  'improvement',
  'observation_follow_up',
  'recommendation',
  'compliance',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Doc 13 §6, O-100. In order of urgency, lowest first. */
export const ACTION_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

/** O-103: evidence is required to complete actions of these priorities. */
export const EVIDENCE_REQUIRED_PRIORITIES: readonly ActionPriority[] = ['high', 'critical'];

/** O-104 (Doc 13 §10). */
export const VERIFICATION_METHODS = [
  'photo_evidence',
  'document_review',
  'site_visit',
  'supervisor_approval',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

/** T-57: the sources registered in Sprint 8. Later modules add theirs. */
export const ACTION_SOURCE_MODULES = ['manual', 'action'] as const;

export const ACTION_UPDATE_KINDS = [
  'start',
  'progress',
  'completion',
  'verification',
  'send_back',
  'closure',
  'void',
] as const;
export type ActionUpdateKind = (typeof ACTION_UPDATE_KINDS)[number];

export const ACTION_LIMITS = {
  titleMin: 5,
  titleMax: 150,
  descriptionMax: 4000,
  noteMax: 2000,
  progressNoteMin: 3,
  completionNoteMin: 10,
  reasonMin: 10,
  changeReasonMin: 5,
  changeReasonMax: 500,
  voidReasonMax: 500,
  /** O-102. */
  collaboratorsMax: 5,
  /** O-108. */
  filesMax: 20,
  filesPerUpload: 10,
  /** O-100: the due date may be set up to two years ahead. */
  dueDaysMax: 730,
} as const;

/** O-108 (Q-31 for action files). */
export const ACTION_FILE_RULES = {
  maxBytes: 10 * 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
} as const;

// ---- Workflow (T-58) ---------------------------------------------------------------------

export const ACTION_TRANSITIONS = [
  'start',
  'complete',
  'verify',
  'send_back',
  'close',
  'verify_and_close',
] as const;
export type ActionTransition = (typeof ACTION_TRANSITIONS)[number];

/** Who may make a move: the action's owner, or a holder of verify / close who isn't a participant. */
export type ActionActor = 'owner' | 'verifier' | 'closer' | 'verifier_closer';

export interface ActionWorkflowStep {
  readonly name: ActionTransition;
  readonly from: readonly ActionStatus[];
  readonly to: ActionStatus;
  readonly actor: ActionActor;
}

/**
 * The action workflow as data (T-58, PLT-23 § Workflow): the API checks every move against it
 * and the web app reads it to show only the buttons that apply.
 */
export const ACTION_WORKFLOW: readonly ActionWorkflowStep[] = [
  { name: 'start', from: ['open'], to: 'in_progress', actor: 'owner' },
  { name: 'complete', from: ['open', 'in_progress'], to: 'completed', actor: 'owner' },
  { name: 'verify', from: ['completed'], to: 'verified', actor: 'verifier' },
  { name: 'send_back', from: ['completed'], to: 'in_progress', actor: 'verifier' },
  { name: 'close', from: ['verified'], to: 'closed', actor: 'closer' },
  { name: 'verify_and_close', from: ['completed'], to: 'closed', actor: 'verifier_closer' },
];

export function workflowStep(name: ActionTransition): ActionWorkflowStep {
  const step = ACTION_WORKFLOW.find((entry) => entry.name === name);
  if (!step) throw new Error(`Unknown action transition ${name}`);
  return step;
}

/** What the caller is to one action, for the workflow check. */
export interface ActionActorFacts {
  owner: boolean;
  /** Owner or current collaborator (O-104: they never verify). */
  participant: boolean;
  verify: boolean;
  close: boolean;
}

export function actorMayMove(actor: ActionActor, facts: ActionActorFacts): boolean {
  switch (actor) {
    case 'owner':
      return facts.owner;
    case 'verifier':
      return facts.verify && !facts.participant;
    case 'closer':
      return facts.close;
    case 'verifier_closer':
      return facts.verify && facts.close && !facts.participant;
  }
}

/** The moves the caller may make now (`allowedTransitions` in every action response). */
export function allowedTransitions(
  status: ActionStatus,
  facts: ActionActorFacts,
): ActionTransition[] {
  return ACTION_WORKFLOW.filter(
    (step) => step.from.includes(status) && actorMayMove(step.actor, facts),
  ).map((step) => step.name);
}

/** Open and In Progress actions can still be edited, reassigned and voided. */
export function isActionActive(status: ActionStatus): boolean {
  return status === 'open' || status === 'in_progress';
}

// ---- Due state (T-59) --------------------------------------------------------------------

export const ACTION_DUE_STATES = ['done', 'on_track', 'due_soon', 'due_today', 'overdue'] as const;
export type ActionDueState = (typeof ACTION_DUE_STATES)[number];

/** T-59: "due soon" means within this many days. */
export const ACTION_DUE_SOON_DAYS = 3;

/** T-59. `today` is the calendar day in the company's time zone. */
export function actionDueState(dueOn: string, status: ActionStatus, today: string): ActionDueState {
  if (status !== 'open' && status !== 'in_progress') return 'done';
  const left = daysBetween(today, dueOn);
  if (left < 0) return 'overdue';
  if (left === 0) return 'due_today';
  if (left <= ACTION_DUE_SOON_DAYS) return 'due_soon';
  return 'on_track';
}

// ---- Numbers (T-60, O-98) ----------------------------------------------------------------

/** O-98: `{project code}-ACT-{0001}`. */
export function actionReference(projectCode: string, number: number): string {
  return `${projectCode}-ACT-${String(number).padStart(4, '0')}`;
}

/** PLT-24 FR-6: `12`, `ACT-12`, `act-0012` or `RMX-02-ACT-0012` → 12; otherwise null. */
export function parseActionNumber(search: string): number | null {
  const match = /^(?:.*-)?(?:act-?)?0*(\d{1,7})$/i.exec(search.trim());
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}

// ---- Requests ----------------------------------------------------------------------------

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidDate');
const fileIds = z.array(z.uuid()).max(ACTION_LIMITS.filesMax).optional();
/** The place picker selection (US-021, O-56, O-112). */
const placeSelectionSchema = z
  .object({
    areaId: z.uuid().nullable().optional(),
    locationId: z.uuid().nullable().optional(),
    workZoneId: z.uuid().nullable().optional(),
  })
  .nullable()
  .optional();

export const createActionRequestSchema = z.object({
  title: trimmed(ACTION_LIMITS.titleMin, ACTION_LIMITS.titleMax),
  type: z.enum(ACTION_TYPES).default('corrective'),
  priority: z.enum(ACTION_PRIORITIES).default('medium'),
  ownerId: z.uuid(),
  dueOn: isoDate,
  description: optionalText(ACTION_LIMITS.descriptionMax),
  place: placeSelectionSchema,
  /** Up to 5 (O-102); the service answers ACTION_COLLABORATOR_LIMIT beyond that. */
  collaboratorIds: z.array(z.uuid()).max(50).optional(),
  /** O-97: a follow-up of a closed action of the same project. */
  followUpOf: z.uuid().optional(),
});
export type CreateActionRequest = z.input<typeof createActionRequestSchema>;

export const updateActionRequestSchema = z.object({
  title: trimmed(ACTION_LIMITS.titleMin, ACTION_LIMITS.titleMax).optional(),
  type: z.enum(ACTION_TYPES).optional(),
  priority: z.enum(ACTION_PRIORITIES).optional(),
  dueOn: isoDate.optional(),
  description: optionalText(ACTION_LIMITS.descriptionMax),
  place: placeSelectionSchema,
  /** Required when priority or due date change (O-100). */
  reason: z.string().trim().max(ACTION_LIMITS.changeReasonMax).optional(),
});
export type UpdateActionRequest = z.input<typeof updateActionRequestSchema>;

export const changeOwnerRequestSchema = z.object({
  ownerId: z.uuid(),
  reason: trimmed(ACTION_LIMITS.changeReasonMin, ACTION_LIMITS.changeReasonMax),
});
export type ChangeOwnerRequest = z.input<typeof changeOwnerRequestSchema>;

export const addCollaboratorsRequestSchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(50),
});
export type AddCollaboratorsRequest = z.input<typeof addCollaboratorsRequestSchema>;

export const progressRequestSchema = z.object({
  note: trimmed(ACTION_LIMITS.progressNoteMin, ACTION_LIMITS.noteMax),
  percent: z
    .number()
    .int()
    .min(0)
    .max(90)
    .refine((value) => value % 10 === 0, 'invalidPercent')
    .nullable()
    .optional(),
  fileIds,
});
export type ProgressRequest = z.input<typeof progressRequestSchema>;

/** One body for every move (T-58); the fields each move needs are checked per name. */
export const transitionRequestSchema = z.discriminatedUnion('transition', [
  z.object({ transition: z.literal('start') }),
  z.object({
    transition: z.literal('complete'),
    note: trimmed(ACTION_LIMITS.completionNoteMin, ACTION_LIMITS.noteMax),
    evidenceFileIds: fileIds,
  }),
  z.object({
    transition: z.literal('verify'),
    method: z.enum(VERIFICATION_METHODS),
    note: optionalText(ACTION_LIMITS.noteMax),
    evidenceFileIds: fileIds,
  }),
  z.object({
    transition: z.literal('send_back'),
    reason: trimmed(ACTION_LIMITS.reasonMin, ACTION_LIMITS.noteMax),
  }),
  z.object({ transition: z.literal('close'), note: optionalText(ACTION_LIMITS.noteMax) }),
  z.object({
    transition: z.literal('verify_and_close'),
    method: z.enum(VERIFICATION_METHODS),
    note: optionalText(ACTION_LIMITS.noteMax),
    evidenceFileIds: fileIds,
  }),
]);
export type TransitionRequest = z.input<typeof transitionRequestSchema>;

export const voidActionRequestSchema = z.object({
  reason: trimmed(ACTION_LIMITS.reasonMin, ACTION_LIMITS.voidReasonMax),
});
export type VoidActionRequest = z.input<typeof voidActionRequestSchema>;

const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return [] as T[number][];
      const parts = value.split(',').filter(Boolean);
      for (const part of parts) {
        if (!(values as readonly string[]).includes(part)) {
          ctx.addIssue({ code: 'custom', message: 'invalidFilter' });
          return z.NEVER;
        }
      }
      return parts as T[number][];
    });

/** PLT-24: the project's Actions tab. Without `status`, closed actions are left out. */
export const actionListQuerySchema = z.object({
  status: csv(ACTION_STATUSES),
  due: csv(['overdue', 'due_today', 'due_soon', 'on_track'] as const),
  priority: csv(ACTION_PRIORITIES),
  type: csv(ACTION_TYPES),
  owner: z.uuid().optional(),
  place: z.uuid().optional(),
  source: z.string().max(40).optional(),
  noAccess: bool,
  voided: bool,
  search: z.string().trim().max(100).optional(),
  cursor: z.coerce.number().int().min(0).default(0),
});
export type ActionListQuery = z.input<typeof actionListQuerySchema>;

export const MY_ACTION_TABS = ['owned', 'collaborating', 'verify'] as const;
export type MyActionTab = (typeof MY_ACTION_TABS)[number];

export const myActionsQuerySchema = z.object({
  tab: z.enum(MY_ACTION_TABS).default('owned'),
  due: csv(['overdue', 'due_today', 'due_soon', 'on_track'] as const),
  cursor: z.coerce.number().int().min(0).default(0),
});

export const actionCandidatesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});

export const ACTION_PAGE_SIZE = 25;

// ---- Responses ---------------------------------------------------------------------------

export interface ActionPersonDto {
  id: string;
  name: string;
  /** O-101: false when the person can no longer view the project. */
  hasAccess: boolean;
}

export interface ActionPlaceDto {
  areaId: string | null;
  locationId: string | null;
  workZoneId: string | null;
  /** The deepest of the three. */
  placeId: string;
  names: string[];
  active: boolean;
}

export interface ActionSourceDto {
  module: string;
  recordId: string | null;
  label: string;
  /** For `action`: the closed action's reference. */
  href: string | null;
}

export interface ActionListItemDto {
  id: string;
  projectId: string;
  projectCode: string;
  reference: string;
  title: string;
  type: ActionType;
  priority: ActionPriority;
  status: ActionStatus;
  dueOn: string;
  dueState: ActionDueState;
  /** Whole days past the due date, when overdue. */
  daysOverdue: number;
  owner: ActionPersonDto;
  place: ActionPlaceDto | null;
  source: ActionSourceDto;
  progressPercent: number | null;
  voided: boolean;
  updatedAt: number;
}

export interface ActionFileDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  updateId: string | null;
  addedBy: string;
  addedAt: number;
}

export interface ActionUpdateDto {
  id: string;
  kind: ActionUpdateKind;
  note: string | null;
  percent: number | null;
  method: VerificationMethod | null;
  by: ActionPersonDto;
  at: number;
  fileIds: string[];
}

export interface ActionOwnerHistoryDto {
  owner: ActionPersonDto;
  fromAt: number;
  toAt: number | null;
  assignedBy: string | null;
  reason: string | null;
}

export interface ActionCanDto {
  edit: boolean;
  reassign: boolean;
  manageCollaborators: boolean;
  void: boolean;
  addProgress: boolean;
  addFiles: boolean;
  comment: boolean;
  followUp: boolean;
  /** O-104: holds verify but is a participant. */
  verifyBlockedAsParticipant: boolean;
}

export interface ActionDto extends ActionListItemDto {
  description: string | null;
  createdBy: ActionPersonDto;
  createdAt: number;
  collaborators: ActionPersonDto[];
  startedAt: number | null;
  completedAt: number | null;
  completedOnTime: boolean | null;
  verifiedAt: number | null;
  verifiedBy: ActionPersonDto | null;
  verificationMethod: VerificationMethod | null;
  closedAt: number | null;
  closedBy: ActionPersonDto | null;
  sendBackCount: number;
  /** The latest send-back reason while the action is In Progress again. */
  sentBackReason: string | null;
  voidedAt: number | null;
  voidReason: string | null;
  followUps: { id: string; reference: string; status: ActionStatus }[];
  updates: ActionUpdateDto[];
  files: ActionFileDto[];
  ownerHistory: ActionOwnerHistoryDto[];
  allowedTransitions: ActionTransition[];
  can: ActionCanDto;
}

export interface ActionPageDto {
  items: ActionListItemDto[];
  nextCursor: number | null;
}

export interface ActionSummaryDto {
  open: number;
  overdue: number;
  dueToday: number;
  toVerify: number;
  closed: number;
}

export interface MyActionsPageDto extends ActionPageDto {
  counts: { owned: number; collaborating: number; verify: number };
}

export interface MyActionsSummaryDto {
  overdue: number;
  dueToday: number;
  toVerify: number;
}

export interface ActionCandidateDto {
  id: string;
  name: string;
  /** Project role, or the company-wide role (O-45). */
  roleCode: string;
  companyWide: boolean;
}
