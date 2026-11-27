import { z } from 'zod';

import { ACTION_PRIORITIES, type ActionPriority } from '../actions/action-contracts';
import { daysBetween } from '../workforce/workforce-rules';

/**
 * The inspection engine (Sprint 10: PLT-32, US-031 – US-039; D-59, D-60). Templates are company
 * records with immutable published versions (T-76); an inspection executes one version (T-77).
 * Statuses are the D-12 list (O-133); Cancelled is a flag.
 */
export const INSPECTION_STATUSES = [
  'draft',
  'in_progress',
  'submitted',
  'approved',
  'closed',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** Doc 10 §9, O-139. */
export const INSPECTION_RESULTS = [
  'pass',
  'fail',
  'observation',
  'not_applicable',
  'not_inspected',
] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];
/** O-139: Pass and Fail are always allowed. */
export const REQUIRED_RESULTS: readonly InspectionResult[] = ['pass', 'fail'];
export const DEFAULT_RESULTS: readonly InspectionResult[] = ['pass', 'fail', 'not_applicable'];

/** Severities are the action priorities, so a finding maps to an action directly (O-145). */
export const FINDING_SEVERITIES = ACTION_PRIORITIES;
export type FindingSeverity = ActionPriority;

/** O-145: due date proposed from the inspection date, in days. */
export const FINDING_DUE_DAYS: Record<FindingSeverity, number> = {
  critical: 1,
  high: 3,
  medium: 7,
  low: 14,
};

export const FINDING_STATUSES = ['open', 'action_raised', 'resolved', 'no_action'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/** O-146: the choice per finding before approval. */
export const FINDING_DECISIONS = ['raise_action', 'no_action'] as const;
export type FindingDecision = (typeof FINDING_DECISIONS)[number];

/** O-148. */
export const INSPECTION_WEATHER = ['clear', 'hot', 'humid', 'windy', 'dust', 'rain', 'cold'] as const;
export type InspectionWeather = (typeof INSPECTION_WEATHER)[number];

/** O-140. */
export const SCORING_METHODS = ['none', 'percentage', 'pass_fail'] as const;
export type ScoringMethod = (typeof SCORING_METHODS)[number];

export const INSPECTION_LIMITS = {
  /** O-151. */
  sectionsMax: 30,
  itemsMax: 300,
  activeTemplatesMax: 200,
  templateNameMin: 3,
  templateNameMax: 120,
  descriptionMax: 1000,
  sectionTitleMin: 2,
  sectionTitleMax: 120,
  questionMin: 2,
  questionMax: 300,
  guidanceMax: 1000,
  categoryNameMin: 2,
  categoryNameMax: 80,
  categoriesMax: 100,
  notesMax: 2000,
  commentMax: 1000,
  reasonMin: 5,
  cancelReasonMax: 500,
  returnReasonMax: 1000,
  noActionReasonMax: 500,
  findingDescriptionMin: 5,
  findingDescriptionMax: 2000,
  /** O-136. */
  photosPerItem: 5,
  headerFilesMax: 20,
  filesMax: 150,
  /** US-033: plans up to a year ahead. */
  planDaysMax: 366,
  /** O-147: a superseded version is still accepted from offline devices this long. */
  supersededGraceDays: 7,
  /** O-150: reviewers are reminded when an inspection waits longer than this. */
  reviewWaitingDays: 2,
} as const;

/** O-136 (Q-31 for inspection files). */
export const INSPECTION_FILE_RULES = {
  maxBytes: 10 * 1024 * 1024,
  contentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  photoTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

// ---- Localised text (O-143) --------------------------------------------------------------

export interface LocalizedText {
  en?: string | null;
  ar?: string | null;
}

/** The text in the reader's language (`ar`, `ar-SA`, `en`, …), else the other one (O-143). */
export function localized(text: LocalizedText | null | undefined, language: string): string {
  if (!text) return '';
  const arabic = language.startsWith('ar');
  const first = arabic ? text.ar : text.en;
  const other = arabic ? text.en : text.ar;
  return (first ?? '').trim() || (other ?? '').trim();
}

const optionalLocal = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'tooLong')
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/** At least one language, each within `min`–`max` when present. */
export const localizedTextSchema = (min: number, max: number) =>
  z
    .object({ en: optionalLocal(max), ar: optionalLocal(max) })
    .superRefine((value, ctx) => {
      const present = [value.en, value.ar].filter((part): part is string => Boolean(part));
      if (present.length === 0) ctx.addIssue({ code: 'custom', message: 'required' });
      if (present.some((part) => part.length < min)) {
        ctx.addIssue({ code: 'custom', message: 'tooShort' });
      }
    });

const optionalLocalized = (max: number) =>
  z
    .object({ en: optionalLocal(max), ar: optionalLocal(max) })
    .nullable()
    .optional();

// ---- Template content (T-76) -------------------------------------------------------------

export const templateItemSchema = z.object({
  key: z.uuid(),
  question: localizedTextSchema(INSPECTION_LIMITS.questionMin, INSPECTION_LIMITS.questionMax),
  expected: optionalLocalized(INSPECTION_LIMITS.guidanceMax),
  guidance: optionalLocalized(INSPECTION_LIMITS.guidanceMax),
  weight: z.number().int().min(1).max(10).default(1),
  critical: z.boolean().default(false),
  defaultPriority: z.enum(FINDING_SEVERITIES).default('medium'),
  photoOnFail: z.boolean().default(true),
  photoAlways: z.boolean().default(false),
});
export type TemplateItem = z.output<typeof templateItemSchema>;

export const templateSectionSchema = z.object({
  key: z.uuid(),
  title: localizedTextSchema(INSPECTION_LIMITS.sectionTitleMin, INSPECTION_LIMITS.sectionTitleMax),
  items: z.array(templateItemSchema).max(INSPECTION_LIMITS.itemsMax),
});
export type TemplateSection = z.output<typeof templateSectionSchema>;

/** A draft may be incomplete; `validateTemplateForPublish` adds the publishing rules. */
export const templateContentSchema = z.object({
  description: optionalLocalized(INSPECTION_LIMITS.descriptionMax),
  results: z
    .array(z.enum(INSPECTION_RESULTS))
    .default([...DEFAULT_RESULTS])
    .transform((values) => {
      const set = new Set<InspectionResult>([...REQUIRED_RESULTS, ...values]);
      return INSPECTION_RESULTS.filter((result) => set.has(result));
    }),
  scoring: z
    .object({
      method: z.enum(SCORING_METHODS).default('none'),
      passMark: z.number().int().min(1).max(100).nullable().default(null),
    })
    .default({ method: 'none', passMark: null }),
  needsApproval: z.boolean().default(true),
  areaRequired: z.boolean().default(false),
  sections: z.array(templateSectionSchema).max(INSPECTION_LIMITS.sectionsMax),
});
export type TemplateContent = z.output<typeof templateContentSchema>;
export type TemplateContentInput = z.input<typeof templateContentSchema>;

export interface TemplateIssue {
  /** e.g. `sections.2.items` or `scoring.passMark`. */
  path: string;
  message:
    | 'noSections'
    | 'emptySection'
    | 'tooManyItems'
    | 'passMarkNotAllowed'
    | 'passFailNeedsRule'
    | 'duplicateKey';
}

/** US-031 FR-4: the rules a draft must meet to be published. */
export function validateTemplateForPublish(content: TemplateContent): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (content.sections.length === 0) issues.push({ path: 'sections', message: 'noSections' });
  content.sections.forEach((section, index) => {
    if (section.items.length === 0) {
      issues.push({ path: `sections.${String(index)}.items`, message: 'emptySection' });
    }
  });
  if (countItems(content) > INSPECTION_LIMITS.itemsMax) {
    issues.push({ path: 'sections', message: 'tooManyItems' });
  }
  const { method, passMark } = content.scoring;
  if (method === 'none' && passMark !== null) {
    issues.push({ path: 'scoring.passMark', message: 'passMarkNotAllowed' });
  }
  if (method === 'pass_fail' && passMark === null && !allItems(content).some((i) => i.critical)) {
    issues.push({ path: 'scoring', message: 'passFailNeedsRule' });
  }
  const keys = new Set<string>();
  for (const key of [
    ...content.sections.map((s) => s.key),
    ...allItems(content).map((i) => i.key),
  ]) {
    if (keys.has(key)) issues.push({ path: 'sections', message: 'duplicateKey' });
    keys.add(key);
  }
  return issues;
}

export function allItems(content: Pick<TemplateContent, 'sections'>): TemplateItem[] {
  return content.sections.flatMap((section) => section.items);
}

export function countItems(content: Pick<TemplateContent, 'sections'>): number {
  return content.sections.reduce((sum, section) => sum + section.items.length, 0);
}

/** US-032: what changed between two versions, by item key. */
export interface TemplateChangeSummary {
  added: string[];
  removed: string[];
  changed: string[];
}

export function templateChanges(
  before: Pick<TemplateContent, 'sections'> | null,
  after: Pick<TemplateContent, 'sections'>,
): TemplateChangeSummary {
  const old = new Map((before ? allItems(before) : []).map((item) => [item.key, item]));
  const next = new Map(allItems(after).map((item) => [item.key, item]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const [key, item] of next) {
    const was = old.get(key);
    if (!was) added.push(key);
    else if (JSON.stringify(was) !== JSON.stringify(item)) changed.push(key);
  }
  const removed = [...old.keys()].filter((key) => !next.has(key));
  return { added, removed, changed };
}

// ---- Scoring (T-81, O-140) ---------------------------------------------------------------

export interface ItemResultLike {
  itemKey: string;
  result: InspectionResult | null;
}

export interface InspectionScore {
  /** null when the template doesn't score or nothing counts yet. */
  percent: number | null;
  outcome: 'pass' | 'fail' | null;
  answered: number;
  total: number;
  failed: number;
}

/**
 * O-140: weighted percentage = Σ weight of Pass (Observation counts as Pass) ÷ Σ weight of Pass +
 * Fail; Not applicable, Not inspected and unanswered items are left out. Pass / Fail fails when a
 * critical item fails or the percentage is below the pass mark. Used on the device and the server.
 */
export function scoreInspection(
  content: Pick<TemplateContent, 'sections' | 'scoring'>,
  results: readonly ItemResultLike[],
): InspectionScore {
  const byKey = new Map(results.map((entry) => [entry.itemKey, entry.result]));
  const items = allItems(content);
  let passWeight = 0;
  let countedWeight = 0;
  let answered = 0;
  let failed = 0;
  let criticalFailed = false;
  for (const item of items) {
    const result = byKey.get(item.key) ?? null;
    if (result === null) continue;
    answered += 1;
    if (result === 'pass' || result === 'observation') {
      passWeight += item.weight;
      countedWeight += item.weight;
    } else if (result === 'fail') {
      failed += 1;
      countedWeight += item.weight;
      if (item.critical) criticalFailed = true;
    }
  }
  const { method, passMark } = content.scoring;
  const base = { answered, total: items.length, failed };
  if (method === 'none') return { ...base, percent: null, outcome: null };
  const percent = countedWeight === 0 ? null : Math.round((passWeight / countedWeight) * 1000) / 10;
  let outcome: InspectionScore['outcome'] = null;
  if (method === 'percentage') {
    outcome = passMark === null || percent === null ? null : percent >= passMark ? 'pass' : 'fail';
  } else {
    if (criticalFailed) outcome = 'fail';
    else if (passMark !== null) outcome = percent === null ? null : percent >= passMark ? 'pass' : 'fail';
    else outcome = answered > 0 ? 'pass' : null;
  }
  return { ...base, percent, outcome };
}

// ---- Readiness (US-036) ------------------------------------------------------------------

export interface ItemCaptureLike extends ItemResultLike {
  comment: string | null;
  /** Uploaded photos on this item (not removed). */
  photoCount: number;
}

export type ReadinessReason =
  | 'unanswered'
  | 'commentRequired'
  | 'photoRequired'
  | 'resultNotAllowed';

export interface ReadinessIssue {
  itemKey: string | null;
  reason: ReadinessReason | 'areaRequired';
}

/** US-036 FR-1: what still blocks submission, in checklist order. */
export function inspectionReadiness(
  content: TemplateContent,
  items: readonly ItemCaptureLike[],
  hasArea: boolean,
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (content.areaRequired && !hasArea) issues.push({ itemKey: null, reason: 'areaRequired' });
  const byKey = new Map(items.map((entry) => [entry.itemKey, entry]));
  for (const item of allItems(content)) {
    const entry = byKey.get(item.key);
    const result = entry?.result ?? null;
    if (result === null) {
      issues.push({ itemKey: item.key, reason: 'unanswered' });
      continue;
    }
    if (!content.results.includes(result)) {
      issues.push({ itemKey: item.key, reason: 'resultNotAllowed' });
      continue;
    }
    const comment = entry?.comment?.trim() ?? '';
    if ((result === 'fail' || result === 'not_inspected') && comment === '') {
      issues.push({ itemKey: item.key, reason: 'commentRequired' });
    }
    const photos = entry?.photoCount ?? 0;
    if (photos === 0 && (item.photoAlways || (result === 'fail' && item.photoOnFail))) {
      issues.push({ itemKey: item.key, reason: 'photoRequired' });
    }
  }
  return issues;
}

// ---- Workflow (T-78) ---------------------------------------------------------------------

export const INSPECTION_TRANSITIONS = [
  'start',
  'reassign',
  'cancel',
  'submit',
  'withdraw',
  'return',
  'approve',
] as const;
export type InspectionTransition = (typeof INSPECTION_TRANSITIONS)[number];

/** Who may make a move (PLT-32 § Workflow). */
export type InspectionActor = 'inspector' | 'manager' | 'approver' | 'inspector_or_manager';

export interface InspectionWorkflowStep {
  readonly name: InspectionTransition;
  readonly from: readonly InspectionStatus[];
  /** null: the status stays (reassign, cancel). */
  readonly to: InspectionStatus | null;
  readonly actor: InspectionActor;
  readonly offline: boolean;
}

export const INSPECTION_WORKFLOW: readonly InspectionWorkflowStep[] = [
  { name: 'start', from: ['draft'], to: 'in_progress', actor: 'inspector', offline: true },
  { name: 'reassign', from: ['draft', 'in_progress'], to: null, actor: 'manager', offline: false },
  {
    name: 'cancel',
    from: ['draft', 'in_progress'],
    to: null,
    actor: 'inspector_or_manager',
    offline: false,
  },
  { name: 'submit', from: ['in_progress'], to: 'submitted', actor: 'inspector', offline: true },
  { name: 'withdraw', from: ['submitted'], to: 'in_progress', actor: 'inspector', offline: false },
  { name: 'return', from: ['submitted'], to: 'in_progress', actor: 'approver', offline: false },
  { name: 'approve', from: ['submitted'], to: 'approved', actor: 'approver', offline: false },
];

export function inspectionStep(name: InspectionTransition): InspectionWorkflowStep {
  const step = INSPECTION_WORKFLOW.find((entry) => entry.name === name);
  if (!step) throw new Error(`Unknown inspection transition ${name}`);
  return step;
}

export interface InspectionActorFacts {
  inspector: boolean;
  /** `projects.inspections.manage`. */
  manage: boolean;
  /** `projects.inspections.approve`. */
  approve: boolean;
  /** The inspection was started without a plan (the inspector may cancel it). */
  unplanned: boolean;
  /** A reviewer has opened it (withdraw is no longer possible). */
  reviewStarted: boolean;
  cancelled: boolean;
}

export function inspectionActorMayMove(
  step: InspectionWorkflowStep,
  facts: InspectionActorFacts,
): boolean {
  switch (step.actor) {
    case 'inspector':
      return facts.inspector && !(step.name === 'withdraw' && facts.reviewStarted);
    case 'manager':
      return facts.manage;
    case 'approver':
      return facts.approve && !facts.inspector;
    case 'inspector_or_manager':
      return facts.manage || (facts.inspector && facts.unplanned);
  }
}

export function allowedInspectionTransitions(
  status: InspectionStatus,
  facts: InspectionActorFacts,
): InspectionTransition[] {
  if (facts.cancelled) return [];
  return INSPECTION_WORKFLOW.filter(
    (step) => step.from.includes(status) && inspectionActorMayMove(step, facts),
  ).map((step) => step.name);
}

export function isInspectionOpen(status: InspectionStatus): boolean {
  return status === 'draft' || status === 'in_progress';
}

/** O-152: overdue while Draft or In Progress past the planned date. */
export function inspectionOverdueDays(
  plannedOn: string | null,
  status: InspectionStatus,
  cancelled: boolean,
  today: string,
): number {
  if (!plannedOn || cancelled || !isInspectionOpen(status)) return 0;
  return Math.max(0, daysBetween(plannedOn, today));
}

// ---- Numbers (T-82, O-135) ---------------------------------------------------------------

export function inspectionReference(projectCode: string, number: number): string {
  return `${projectCode}-INS-${String(number).padStart(4, '0')}`;
}

/** `12`, `INS-12`, `ins-0012` or `RMX-02-INS-0012` → 12; otherwise null. */
export function parseInspectionNumber(search: string): number | null {
  const match = /^(?:.*-)?(?:ins-?)?0*(\d{1,7})$/i.exec(search.trim());
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}

// ---- Offline (T-80) ----------------------------------------------------------------------

export const INSPECTION_ENTITY = 'inspection';
export const INSPECTION_ITEM_ENTITY = 'inspection_item';
export const INSPECTION_CONFLICT_FIELDS = ['placeId', 'inspectedOn', 'weather', 'notes'] as const;
export const INSPECTION_ITEM_CONFLICT_FIELDS = [
  'result',
  'comment',
  'priority',
  'assignedTo',
  'raiseFinding',
] as const;
export const INSPECTION_TEMPLATES_PACK = 'inspection-templates';

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
const placeSelectionSchema = z
  .object({
    areaId: z.uuid().nullable().optional(),
    locationId: z.uuid().nullable().optional(),
    workZoneId: z.uuid().nullable().optional(),
  })
  .nullable()
  .optional();

const templateNames = z
  .object({
    nameEn: optionalText(INSPECTION_LIMITS.templateNameMax),
    nameAr: optionalText(INSPECTION_LIMITS.templateNameMax),
  })
  .superRefine((value, ctx) => {
    const names = [value.nameEn, value.nameAr].filter((n): n is string => Boolean(n));
    if (names.length === 0) ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'required' });
    if (names.some((n) => n.length < INSPECTION_LIMITS.templateNameMin)) {
      ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'tooShort' });
    }
  });

export const createTemplateRequestSchema = z.intersection(
  templateNames,
  z.object({ categoryId: z.uuid() }),
);
export type CreateTemplateRequest = z.input<typeof createTemplateRequestSchema>;

/** US-031 FR-2: the builder saves the whole draft with the time it last read. */
export const saveDraftRequestSchema = z.object({
  nameEn: optionalText(INSPECTION_LIMITS.templateNameMax),
  nameAr: optionalText(INSPECTION_LIMITS.templateNameMax),
  categoryId: z.uuid().optional(),
  content: templateContentSchema,
  expectedUpdatedAt: z.number().int(),
});
export type SaveDraftRequest = z.input<typeof saveDraftRequestSchema>;

export const categoryRequestSchema = z.object({
  nameEn: optionalText(INSPECTION_LIMITS.categoryNameMax),
  nameAr: optionalText(INSPECTION_LIMITS.categoryNameMax),
});
export type CategoryRequest = z.input<typeof categoryRequestSchema>;

export const moveRequestSchema = z.object({ direction: z.enum(['up', 'down']) });

export const templateListQuerySchema = z.object({
  status: z.enum(['active', 'retired']).optional(),
  category: z.uuid().optional(),
});

const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).nullable().optional(),
  })
  .nullable()
  .optional();

/** US-033: plan (online, Draft) or start on the spot (offline-capable, In Progress). */
export const createInspectionRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('plan'),
    templateId: z.uuid(),
    inspectorId: z.uuid(),
    plannedOn: isoDate,
    place: placeSelectionSchema,
    note: optionalText(INSPECTION_LIMITS.notesMax),
  }),
  z.object({
    mode: z.literal('start'),
    /** T-68: made on the device. */
    id: z.uuid().optional(),
    templateVersionId: z.uuid(),
    place: placeSelectionSchema,
    inspectedOn: isoDate.optional(),
    weather: z.enum(INSPECTION_WEATHER).nullable().optional(),
    notes: optionalText(INSPECTION_LIMITS.notesMax),
    location: locationSchema,
    followUpOf: z.uuid().optional(),
  }),
]);
export type CreateInspectionRequest = z.input<typeof createInspectionRequestSchema>;

/** Draft fields (plan) and In Progress header fields (offline: only changed ones). */
export const updateInspectionRequestSchema = z.object({
  templateId: z.uuid().optional(),
  plannedOn: isoDate.optional(),
  note: optionalText(INSPECTION_LIMITS.notesMax),
  place: placeSelectionSchema,
  placeId: z.uuid().nullable().optional(),
  inspectedOn: isoDate.optional(),
  weather: z.enum(INSPECTION_WEATHER).nullable().optional(),
  notes: optionalText(INSPECTION_LIMITS.notesMax),
  location: locationSchema,
  baseVersion: z.number().int().min(1).optional(),
});
export type UpdateInspectionRequest = z.input<typeof updateInspectionRequestSchema>;

export const itemResultRequestSchema = z.object({
  result: z.enum(INSPECTION_RESULTS).nullable().optional(),
  comment: optionalText(INSPECTION_LIMITS.commentMax),
  priority: z.enum(FINDING_SEVERITIES).nullable().optional(),
  assignedTo: z.uuid().nullable().optional(),
  raiseFinding: z.boolean().optional(),
  baseVersion: z.number().int().min(1).optional(),
});
export type ItemResultRequest = z.input<typeof itemResultRequestSchema>;

const findingChoice = z.object({
  findingId: z.uuid().optional(),
  itemKey: z.uuid().optional(),
  decision: z.enum(FINDING_DECISIONS),
  reason: optionalText(INSPECTION_LIMITS.noActionReasonMax),
});

export const inspectionTransitionRequestSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('start') }),
  z.object({ to: z.literal('reassign'), inspectorId: z.uuid() }),
  z.object({
    to: z.literal('cancel'),
    reason: trimmed(INSPECTION_LIMITS.reasonMin, INSPECTION_LIMITS.cancelReasonMax),
  }),
  z.object({
    to: z.literal('submit'),
    findingChoices: z.array(findingChoice).max(INSPECTION_LIMITS.itemsMax).optional(),
  }),
  z.object({ to: z.literal('withdraw') }),
  z.object({
    to: z.literal('return'),
    reason: trimmed(INSPECTION_LIMITS.reasonMin, INSPECTION_LIMITS.returnReasonMax),
  }),
  z.object({
    to: z.literal('approve'),
    findingChoices: z.array(findingChoice).max(INSPECTION_LIMITS.itemsMax).optional(),
  }),
]);
export type InspectionTransitionRequest = z.input<typeof inspectionTransitionRequestSchema>;

export const updateFindingRequestSchema = z.object({
  description: trimmed(
    INSPECTION_LIMITS.findingDescriptionMin,
    INSPECTION_LIMITS.findingDescriptionMax,
  ).optional(),
  severity: z.enum(FINDING_SEVERITIES).optional(),
  responsibleId: z.uuid().nullable().optional(),
  dueOn: isoDate.optional(),
  decision: z.enum(FINDING_DECISIONS).optional(),
  reason: optionalText(INSPECTION_LIMITS.noActionReasonMax),
});
export type UpdateFindingRequest = z.input<typeof updateFindingRequestSchema>;

export const raiseFindingActionRequestSchema = z.object({
  ownerId: z.uuid(),
  dueOn: isoDate,
  title: z.string().trim().min(5).max(150).optional(),
  description: optionalText(4000),
  priority: z.enum(FINDING_SEVERITIES).optional(),
});
export type RaiseFindingActionRequest = z.input<typeof raiseFindingActionRequestSchema>;

export const noActionRequestSchema = z.object({
  reason: trimmed(INSPECTION_LIMITS.reasonMin, INSPECTION_LIMITS.noActionReasonMax),
});

const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

export const INSPECTION_FILTERS = [
  'today',
  'overdue',
  'in_progress',
  'to_review',
  'mine',
] as const;

export const inspectionListQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return [] as InspectionStatus[];
      const parts = value.split(',').filter(Boolean);
      for (const part of parts) {
        if (!(INSPECTION_STATUSES as readonly string[]).includes(part)) {
          ctx.addIssue({ code: 'custom', message: 'invalidFilter' });
          return z.NEVER;
        }
      }
      return parts as InspectionStatus[];
    }),
  filter: z.enum(INSPECTION_FILTERS).optional(),
  template: z.uuid().optional(),
  inspector: z.uuid().optional(),
  place: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cancelled: bool,
  search: z.string().trim().max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type InspectionListQuery = z.output<typeof inspectionListQuerySchema>;

export const myInspectionsQuerySchema = z.object({
  tab: z.enum(['assigned', 'in_progress', 'to_review']).default('assigned'),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MyInspectionsQuery = z.output<typeof myInspectionsQuerySchema>;

export const findingListQuerySchema = z.object({
  status: z.enum(['open', 'all']).default('open'),
  severity: z.enum(FINDING_SEVERITIES).optional(),
  place: z.uuid().optional(),
  overdue: bool,
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type FindingListQuery = z.output<typeof findingListQuerySchema>;

// ---- Responses ---------------------------------------------------------------------------

export interface PersonRefDto {
  id: string;
  name: string;
}

export interface InspectionCategoryDto {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  position: number;
  active: boolean;
  templateCount: number;
}

export interface TemplateVersionDto {
  id: string;
  versionNo: number;
  state: 'draft' | 'published' | 'superseded';
  content: TemplateContent;
  itemCount: number;
  publishedAt: number | null;
  publishedBy: PersonRefDto | null;
  supersededAt: number | null;
  updatedAt: number;
}

export interface TemplateSummaryDto {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  category: { id: string; nameEn: string | null; nameAr: string | null };
  status: 'active' | 'retired';
  currentVersionId: string | null;
  currentVersionNo: number | null;
  itemCount: number;
  hasDraft: boolean;
  updatedAt: number;
}

export interface TemplateDetailDto extends TemplateSummaryDto {
  current: TemplateVersionDto | null;
  /** Managers only. */
  draft: TemplateVersionDto | null;
  /** Draft vs current, by item key (US-032). */
  changes: TemplateChangeSummary | null;
  canManage: boolean;
}

export interface TemplateVersionListItemDto {
  id: string;
  versionNo: number;
  state: 'published' | 'superseded';
  publishedAt: number | null;
  publishedBy: PersonRefDto | null;
  inspectionCount: number;
}

/** The device pack of published versions (T-80). */
export interface TemplatePackVersionDto {
  templateId: string;
  versionId: string;
  versionNo: number;
  nameEn: string | null;
  nameAr: string | null;
  categoryNameEn: string | null;
  categoryNameAr: string | null;
  current: boolean;
  publishedAt: number;
  supersededAt: number | null;
  content: TemplateContent;
}

export interface TemplatePackDto {
  versions: TemplatePackVersionDto[];
  generatedAt: number;
}

export interface InspectionFileDto {
  id: string;
  itemKey: string | null;
  name: string;
  size: number;
  contentType: string;
  capturedAt: number;
  uploadedBy: string;
  /** Submitted files can never be removed (US-035). */
  removable: boolean;
}

export interface InspectionItemDto {
  itemKey: string;
  result: InspectionResult | null;
  comment: string | null;
  priority: FindingSeverity | null;
  assignedTo: PersonRefDto | null;
  raiseFinding: boolean;
  version: number;
}

export interface FindingActionDto {
  id: string;
  reference: string;
  status: string;
  voided: boolean;
  ownerName: string;
  dueOn: string;
}

export interface FindingDto {
  id: string;
  seq: number;
  itemKey: string;
  description: string;
  severity: FindingSeverity;
  categoryEn: string | null;
  categoryAr: string | null;
  responsible: PersonRefDto | null;
  dueOn: string;
  status: FindingStatus;
  decision: FindingDecision | null;
  noActionReason: string | null;
  edited: boolean;
  actions: FindingActionDto[];
  photoIds: string[];
}

export interface InspectionSummaryDto {
  id: string;
  number: number | null;
  reference: string | null;
  projectId: string;
  projectCode: string;
  templateId: string;
  templateNameEn: string | null;
  templateNameAr: string | null;
  versionNo: number;
  status: InspectionStatus;
  cancelled: boolean;
  inspector: PersonRefDto;
  plannedOn: string | null;
  inspectedOn: string | null;
  placeName: string | null;
  scorePercent: number | null;
  scoreOutcome: 'pass' | 'fail' | null;
  findingCount: number;
  openFindingCount: number;
  overdueDays: number;
  underReview: boolean;
  offline: boolean;
  updatedAt: number;
}

export interface InspectionDto extends InspectionSummaryDto {
  templateVersionId: string;
  content: TemplateContent;
  planner: PersonRefDto | null;
  note: string | null;
  place: PlaceSelectionRef;
  weather: InspectionWeather | null;
  notes: string | null;
  location: { latitude: number; longitude: number; accuracy: number | null } | null;
  startedAt: number | null;
  submittedAt: number | null;
  approvedAt: number | null;
  approvedBy: PersonRefDto | null;
  approvedOnSubmit: boolean;
  closedAt: number | null;
  cancelReason: string | null;
  followUpOf: { id: string; reference: string | null } | null;
  capturedAt: number | null;
  receivedAt: number;
  items: InspectionItemDto[];
  files: InspectionFileDto[];
  findings: FindingDto[];
  allowedTransitions: InspectionTransition[];
  canCapture: boolean;
  canEditFindings: boolean;
  canRaiseActions: boolean;
  canComment: boolean;
  version: number;
}

export interface PlaceSelectionRef {
  areaId: string | null;
  locationId: string | null;
  workZoneId: string | null;
}

export interface InspectionCountsDto {
  today: number;
  overdue: number;
  inProgress: number;
  toReview: number;
  openFindings: number;
}

export interface InspectionPageDto {
  items: InspectionSummaryDto[];
  total: number;
  counts: InspectionCountsDto;
  canPlan: boolean;
  canStart: boolean;
}

export interface MyInspectionsPageDto {
  items: InspectionSummaryDto[];
  total: number;
  counts: { assigned: number; inProgress: number; toReview: number };
}

export interface ProjectFindingDto extends FindingDto {
  inspectionId: string;
  inspectionReference: string | null;
  placeName: string | null;
}

export interface FindingPageDto {
  items: ProjectFindingDto[];
  total: number;
}

export interface ReadinessDto {
  issues: ReadinessIssue[];
  score: InspectionScore;
  findingCount: number;
}

/** O-145: the proposed due date of a finding. */
export function findingDueOn(inspectedOn: string, severity: FindingSeverity): string {
  const date = new Date(`${inspectedOn}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + FINDING_DUE_DAYS[severity]);
  return date.toISOString().slice(0, 10);
}
