import { z } from "zod";

import {
  ACTION_PRIORITIES,
  type ActionPriority,
} from "../actions/action-contracts";
import type { RiskBandKey, RiskText } from "../risk/risk-contracts";

/**
 * The safety event engine (Sprint 11: PLT-33, US-040 – US-046; D-62, D-63). One event model for
 * hazards, near misses and incidents (T-84); the type's family decides the form (T-85); the
 * workflow is data (T-86); the investigation is stored apart (T-88).
 */
export const SAFETY_EVENT_FAMILIES = [
  "hazard",
  "near_miss",
  "incident",
] as const;
export type SafetyEventFamily = (typeof SAFETY_EVENT_FAMILIES)[number];

/** O-157. Voided is a flag; "Under review" a label. */
export const SAFETY_EVENT_STATUSES = [
  "reported",
  "under_investigation",
  "corrective_action",
  "verification",
  "closed",
] as const;
export type SafetyEventStatus = (typeof SAFETY_EVENT_STATUSES)[number];

/** O-166: the four fixed levels (the action priorities, so actions map directly). */
export const SAFETY_SEVERITIES = ACTION_PRIORITIES;
export type SafetySeverity = ActionPriority;

export const INVESTIGATION_RULES = [
  "required",
  "by_severity",
  "optional",
] as const;
export type InvestigationRule = (typeof INVESTIGATION_RULES)[number];

export const RISK_RATING_RULES = ["required", "optional"] as const;
export type RiskRatingRule = (typeof RISK_RATING_RULES)[number];

export const SAFETY_VOID_KINDS = [
  "duplicate",
  "not_safety_event",
  "reported_in_error",
] as const;
export type SafetyVoidKind = (typeof SAFETY_VOID_KINDS)[number];

export const RECOMMENDATION_KINDS = [
  "immediate",
  "corrective",
  "preventive",
  "improvement",
] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

export const RECOMMENDATION_STATUSES = [
  "open",
  "action_raised",
  "resolved",
  "no_action",
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

/** The company lists of the module (O-165, O-171). */
export const SAFETY_LISTS = [
  "category",
  "immediate_cause",
  "root_cause",
] as const;
export type SafetyList = (typeof SAFETY_LISTS)[number];

export const CAUSE_KINDS = ["immediate", "root", "contributing"] as const;
export type CauseKind = (typeof CAUSE_KINDS)[number];

/** O-173. */
export const PERSON_ROLES = ["injured", "involved"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];
export const INJURY_NATURES = [
  "cut",
  "bruise",
  "fracture",
  "burn",
  "sprain",
  "eye_injury",
  "inhalation",
  "other",
] as const;
export type InjuryNature = (typeof INJURY_NATURES)[number];
export const BODY_PARTS = [
  "head",
  "eye",
  "face",
  "neck",
  "shoulder",
  "arm",
  "hand",
  "finger",
  "back",
  "chest",
  "abdomen",
  "leg",
  "knee",
  "foot",
  "multiple",
  "other",
] as const;
export type BodyPart = (typeof BODY_PARTS)[number];
export const TREATMENTS = [
  "none",
  "first_aid",
  "medical_treatment",
  "hospitalised",
] as const;
export type Treatment = (typeof TREATMENTS)[number];

export const CLOSURE_KINDS = ["completed", "no_further_action"] as const;
export type ClosureKind = (typeof CLOSURE_KINDS)[number];

export const SAFETY_EVENT_LIMITS = {
  titleMin: 5,
  titleMax: 120,
  descriptionMin: 10,
  descriptionMax: 4000,
  potentialOutcomeMin: 10,
  potentialOutcomeMax: 1000,
  detailsMax: 2000,
  reviewNoteMax: 2000,
  instructionsMax: 1000,
  investigationTextMax: 4000,
  causeTextMax: 1000,
  whyMax: 300,
  whysMax: 5,
  causesMax: 10,
  recommendationsMax: 20,
  statementMax: 4000,
  closureMin: 10,
  closureMax: 2000,
  reasonMin: 5,
  reasonMax: 500,
  returnReasonMax: 1000,
  personDetailMax: 1000,
  nameMin: 2,
  nameMax: 120,
  contactMax: 120,
  companyMax: 120,
  categoriesMax: 3,
  peopleMax: 20,
  witnessesMax: 20,
  teamMax: 5,
  typesMax: 50,
  listItemsMax: 50,
  listNameMin: 2,
  listNameMax: 80,
  daysLostMax: 365,
  /** O-162. */
  reportFilesMax: 20,
  filesMax: 100,
  sensitiveFilesMax: 10,
  /** O-177. */
  occurredMaxAgeDays: 365,
  futureToleranceMs: 5 * 60 * 1000,
  lateAfterMs: 24 * 60 * 60 * 1000,
  /** O-182. */
  reviewWaitingDays: 1,
  /** O-118: an inactive type is still accepted from offline devices this long. */
  inactiveTypeGraceDays: 7,
} as const;

/** O-162 (Q-31 for safety event files). */
export const SAFETY_EVENT_FILE_RULES = {
  maxBytes: 10 * 1024 * 1024,
  contentTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  sensitiveContentTypes: ["image/jpeg", "image/png", "application/pdf"],
} as const;

/** O-170: investigation due date proposed from the review day. */
export const INVESTIGATION_DUE_DAYS: Record<SafetySeverity, number> = {
  critical: 7,
  high: 14,
  medium: 21,
  low: 30,
};

export function severityRank(severity: SafetySeverity): number {
  return SAFETY_SEVERITIES.indexOf(severity);
}

export function severityAtLeast(
  severity: SafetySeverity,
  minimum: SafetySeverity | null | undefined,
): boolean {
  return !minimum || severityRank(severity) >= severityRank(minimum);
}

/** O-159 (Q-21): the one rule, used by the device and the server. */
export function investigationRequired(
  rule: InvestigationRule,
  severity: SafetySeverity | null | undefined,
): boolean {
  if (rule === "required") return true;
  if (rule === "optional") return false;
  return severity === "high" || severity === "critical";
}

/** O-177. */
export function occurredAtIssue(
  occurredAt: number,
  reference: number,
): "future" | "tooOld" | null {
  if (occurredAt > reference + SAFETY_EVENT_LIMITS.futureToleranceMs)
    return "future";
  if (
    reference - occurredAt >
    SAFETY_EVENT_LIMITS.occurredMaxAgeDays * 24 * 60 * 60 * 1000
  )
    return "tooOld";
  return null;
}

export function reportedLate(occurredAt: number, reportedAt: number): boolean {
  return reportedAt - occurredAt > SAFETY_EVENT_LIMITS.lateAfterMs;
}

export function safetyEventReference(
  projectCode: string,
  number: number | null | undefined,
): string | null {
  if (number === null || number === undefined) return null;
  return `${projectCode}-EVT-${String(number).padStart(4, "0")}`;
}

/** "RMX-02-EVT-0014", "EVT-0014", "0014" or "14" → 14. */
export function parseSafetyEventNumber(search: string): number | null {
  const match = /(?:EVT-)?0*(\d{1,6})$/i.exec(search.trim());
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}

// ---- Seeds (O-164, O-165, O-171) ----------------------------------------------------------

export interface SeedEventType {
  key: string;
  en: string;
  ar: string;
  family: SafetyEventFamily;
  investigation: InvestigationRule;
  minSeverity: SafetySeverity | null;
  injuryDetails: boolean;
  riskRating: RiskRatingRule;
}

export const SEED_EVENT_TYPES: readonly SeedEventType[] = [
  {
    key: "hazard",
    en: "Hazard",
    ar: "خطر",
    family: "hazard",
    investigation: "by_severity",
    minSeverity: null,
    injuryDetails: false,
    riskRating: "required",
  },
  {
    key: "unsafe_act",
    en: "Unsafe Act",
    ar: "تصرف غير آمن",
    family: "hazard",
    investigation: "by_severity",
    minSeverity: null,
    injuryDetails: false,
    riskRating: "required",
  },
  {
    key: "unsafe_condition",
    en: "Unsafe Condition",
    ar: "ظرف غير آمن",
    family: "hazard",
    investigation: "by_severity",
    minSeverity: null,
    injuryDetails: false,
    riskRating: "required",
  },
  {
    key: "near_miss",
    en: "Near Miss",
    ar: "حادث وشيك",
    family: "near_miss",
    investigation: "by_severity",
    minSeverity: null,
    injuryDetails: false,
    riskRating: "required",
  },
  {
    key: "property_damage",
    en: "Property Damage",
    ar: "أضرار بالممتلكات",
    family: "incident",
    investigation: "by_severity",
    minSeverity: null,
    injuryDetails: false,
    riskRating: "optional",
  },
  {
    key: "environmental",
    en: "Environmental Event",
    ar: "حدث بيئي",
    family: "incident",
    investigation: "by_severity",
    minSeverity: null,
    injuryDetails: false,
    riskRating: "optional",
  },
  {
    key: "first_aid",
    en: "First Aid Case",
    ar: "حالة إسعاف أولي",
    family: "incident",
    investigation: "by_severity",
    minSeverity: null,
    injuryDetails: true,
    riskRating: "optional",
  },
  {
    key: "medical_treatment",
    en: "Medical Treatment Case",
    ar: "حالة علاج طبي",
    family: "incident",
    investigation: "required",
    minSeverity: "medium",
    injuryDetails: true,
    riskRating: "optional",
  },
  {
    key: "lost_time_injury",
    en: "Lost Time Injury",
    ar: "إصابة مضيعة للوقت",
    family: "incident",
    investigation: "required",
    minSeverity: "high",
    injuryDetails: true,
    riskRating: "optional",
  },
  {
    key: "fatality",
    en: "Fatality",
    ar: "وفاة",
    family: "incident",
    investigation: "required",
    minSeverity: "critical",
    injuryDetails: true,
    riskRating: "optional",
  },
];

export const SEED_SAFETY_LISTS: Record<
  SafetyList,
  readonly { key: string; en: string; ar: string }[]
> = {
  category: [
    {
      key: "working_at_height",
      en: "Working at Height",
      ar: "العمل على ارتفاع",
    },
    { key: "electrical", en: "Electrical", ar: "الكهرباء" },
    { key: "fire", en: "Fire", ar: "الحريق" },
    { key: "excavation", en: "Excavation", ar: "الحفريات" },
    { key: "lifting", en: "Lifting", ar: "الرفع" },
    { key: "vehicle", en: "Vehicle", ar: "المركبات" },
    { key: "housekeeping", en: "Housekeeping", ar: "النظافة والترتيب" },
    { key: "chemical", en: "Chemical", ar: "المواد الكيميائية" },
    { key: "environmental", en: "Environmental", ar: "البيئة" },
    { key: "ppe", en: "PPE", ar: "معدات الوقاية الشخصية" },
    { key: "machinery", en: "Machinery", ar: "الآلات" },
  ],
  immediate_cause: [
    { key: "unsafe_act", en: "Unsafe act", ar: "تصرف غير آمن" },
    { key: "unsafe_condition", en: "Unsafe condition", ar: "ظرف غير آمن" },
  ],
  root_cause: [
    { key: "people", en: "People / Competence", ar: "الأفراد / الكفاءة" },
    { key: "procedures", en: "Procedures", ar: "الإجراءات" },
    { key: "equipment", en: "Equipment / Tools", ar: "المعدات / الأدوات" },
    { key: "environment", en: "Work environment", ar: "بيئة العمل" },
    { key: "supervision", en: "Supervision", ar: "الإشراف" },
    {
      key: "management",
      en: "Management / Organisation",
      ar: "الإدارة / التنظيم",
    },
    { key: "design", en: "Design", ar: "التصميم" },
  ],
};

// ---- Workflow (T-86) ----------------------------------------------------------------------

export const SAFETY_EVENT_TRANSITIONS = [
  "assign",
  "act",
  "close",
  "reassign",
  "complete_investigation",
  "return",
  "void",
] as const;
export type SafetyEventTransition = (typeof SAFETY_EVENT_TRANSITIONS)[number];

export type SafetyEventActor = "manager" | "closer" | "lead";

export interface SafetyEventWorkflowStep {
  name: SafetyEventTransition;
  from: readonly SafetyEventStatus[];
  /** null: the status doesn't change (reassign, void). */
  to: SafetyEventStatus | null;
  actor: SafetyEventActor;
  offline: false;
}

export const SAFETY_EVENT_WORKFLOW: readonly SafetyEventWorkflowStep[] = [
  {
    name: "assign",
    from: ["reported"],
    to: "under_investigation",
    actor: "manager",
    offline: false,
  },
  {
    name: "act",
    from: ["reported"],
    to: "corrective_action",
    actor: "manager",
    offline: false,
  },
  {
    name: "close",
    from: ["reported", "verification"],
    to: "closed",
    actor: "closer",
    offline: false,
  },
  {
    name: "reassign",
    from: ["under_investigation"],
    to: null,
    actor: "manager",
    offline: false,
  },
  {
    name: "complete_investigation",
    from: ["under_investigation"],
    to: "corrective_action",
    actor: "lead",
    offline: false,
  },
  {
    name: "return",
    from: ["verification"],
    to: "under_investigation",
    actor: "closer",
    offline: false,
  },
  {
    name: "void",
    from: ["reported", "under_investigation", "corrective_action"],
    to: null,
    actor: "manager",
    offline: false,
  },
];

export function safetyEventStep(
  name: SafetyEventTransition,
): SafetyEventWorkflowStep {
  const step = SAFETY_EVENT_WORKFLOW.find((entry) => entry.name === name);
  if (!step) throw new Error(`Unknown safety event transition ${name}`);
  return step;
}

export interface SafetyEventActorFacts {
  manage: boolean;
  close: boolean;
  /** The caller is the lead investigator. */
  lead: boolean;
  investigationRequired: boolean;
  /** The event has (or had) an investigation. */
  investigated: boolean;
  voided: boolean;
}

export function safetyEventActorMayMove(
  step: SafetyEventWorkflowStep,
  facts: SafetyEventActorFacts,
): boolean {
  if (facts.voided) return false;
  switch (step.actor) {
    case "manager":
      if (step.name === "act")
        return facts.manage && !facts.investigationRequired;
      return facts.manage;
    case "lead":
      return facts.lead;
    case "closer":
      if (step.name === "return")
        return facts.close && facts.investigated && !facts.lead;
      return facts.close;
  }
}

export function allowedSafetyEventTransitions(
  status: SafetyEventStatus,
  facts: SafetyEventActorFacts,
): SafetyEventTransition[] {
  return SAFETY_EVENT_WORKFLOW.filter((step) => {
    if (!step.from.includes(status) || !safetyEventActorMayMove(step, facts))
      return false;
    // From Reported, close is "No further action": never when an investigation is required.
    if (
      step.name === "close" &&
      status === "reported" &&
      facts.investigationRequired
    )
      return false;
    return true;
  }).map((step) => step.name);
}

export function isSafetyEventOpen(status: SafetyEventStatus): boolean {
  return status !== "closed";
}

export const SAFETY_EVENT_ENTITY = "safety_event";
export const SAFETY_EVENT_CONFLICT_FIELDS = [
  "title",
  "description",
  "occurredAt",
  "placeId",
  "reportedSeverity",
  "immediateAction",
  "typeId",
  "categoryIds",
] as const;
/** T-90: the module's own reference pack. */
export const SAFETY_EVENT_SETTINGS_PACK = "safety-event-settings";

// ---- Requests ----------------------------------------------------------------------------

const L = SAFETY_EVENT_LIMITS;
const trimmed = (min: number, max: number) =>
  z.string().trim().min(min, "tooShort").max(max, "tooLong");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate");
const placeSelectionSchema = z
  .object({
    areaId: z.uuid().nullable().optional(),
    locationId: z.uuid().nullable().optional(),
    workZoneId: z.uuid().nullable().optional(),
  })
  .nullable()
  .optional();
const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).nullable().optional(),
  })
  .nullable()
  .optional();
const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");

/** A person given by link or by name (O-172, O-173). */
const personRef = {
  workforceMemberId: z.uuid().nullable().optional(),
  userId: z.uuid().nullable().optional(),
  name: optionalText(L.nameMax),
};

export const safetyPersonSchema = z
  .object({
    id: z.uuid().optional(),
    ...personRef,
    role: z.enum(PERSON_ROLES),
    injuryNature: z.enum(INJURY_NATURES).nullable().optional(),
    bodyPart: z.enum(BODY_PARTS).nullable().optional(),
    treatment: z.enum(TREATMENTS).nullable().optional(),
    daysLost: z.number().int().min(0).max(L.daysLostMax).nullable().optional(),
    detail: optionalText(L.personDetailMax),
  })
  .superRefine((value, ctx) => {
    if (
      !value.workforceMemberId &&
      !value.userId &&
      (!value.name || value.name.length < L.nameMin)
    ) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "required" });
    }
  });
export type SafetyPersonInput = z.input<typeof safetyPersonSchema>;

export const reportWitnessSchema = z
  .object({
    ...personRef,
    company: optionalText(L.companyMax),
    contact: optionalText(L.contactMax),
  })
  .superRefine((value, ctx) => {
    if (
      !value.workforceMemberId &&
      !value.userId &&
      (!value.name || value.name.length < L.nameMin)
    ) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "required" });
    }
  });

/** US-040 – US-042: one report for every family (offline-capable). */
export const reportSafetyEventRequestSchema = z.object({
  /** T-68: made on the device. */
  id: z.uuid().optional(),
  typeId: z.uuid(),
  title: trimmed(L.titleMin, L.titleMax),
  description: trimmed(L.descriptionMin, L.descriptionMax),
  occurredAt: z.number().int().min(0),
  place: placeSelectionSchema,
  location: locationSchema,
  reportedSeverity: z.enum(SAFETY_SEVERITIES),
  categoryIds: z.array(z.uuid()).max(L.categoriesMax).default([]),
  immediateAction: optionalText(L.detailsMax),
  potentialOutcome: optionalText(L.potentialOutcomeMax),
  damageDetails: optionalText(L.detailsMax),
  environmentDetails: optionalText(L.detailsMax),
  people: z.array(safetyPersonSchema).max(L.peopleMax).default([]),
  witnesses: z.array(reportWitnessSchema).max(L.witnessesMax).default([]),
  followUpOf: z.uuid().optional(),
});
export type ReportSafetyEventRequest = z.input<
  typeof reportSafetyEventRequestSchema
>;

/** Reporter edits before review starts (offline: only changed fields). */
export const updateSafetyEventRequestSchema = z.object({
  typeId: z.uuid().optional(),
  title: trimmed(L.titleMin, L.titleMax).optional(),
  description: trimmed(L.descriptionMin, L.descriptionMax).optional(),
  occurredAt: z.number().int().min(0).optional(),
  place: placeSelectionSchema,
  placeId: z.uuid().nullable().optional(),
  location: locationSchema,
  reportedSeverity: z.enum(SAFETY_SEVERITIES).optional(),
  categoryIds: z.array(z.uuid()).max(L.categoriesMax).optional(),
  immediateAction: optionalText(L.detailsMax),
  potentialOutcome: optionalText(L.potentialOutcomeMax),
  damageDetails: optionalText(L.detailsMax),
  environmentDetails: optionalText(L.detailsMax),
  baseVersion: z.number().int().min(1).optional(),
});
export type UpdateSafetyEventRequest = z.input<
  typeof updateSafetyEventRequestSchema
>;

/** US-043: the reviewer's classification. */
export const classifySafetyEventRequestSchema = z.object({
  typeId: z.uuid().optional(),
  categoryIds: z.array(z.uuid()).min(1).max(L.categoriesMax).optional(),
  severity: z.enum(SAFETY_SEVERITIES).optional(),
  risk: z
    .object({
      likelihood: z.number().int().min(1).max(5),
      consequence: z.number().int().min(1).max(5),
    })
    .nullable()
    .optional(),
  place: placeSelectionSchema,
  reviewNote: optionalText(L.reviewNoteMax),
  baseVersion: z.number().int().min(1).optional(),
});
export type ClassifySafetyEventRequest = z.input<
  typeof classifySafetyEventRequestSchema
>;

const actionInput = z.object({
  title: trimmed(5, 150),
  description: optionalText(4000),
  ownerId: z.uuid(),
  dueOn: isoDate,
  priority: z.enum(SAFETY_SEVERITIES).optional(),
});
export type SafetyActionInput = z.input<typeof actionInput>;

export const safetyEventTransitionRequestSchema = z.discriminatedUnion("to", [
  z.object({
    to: z.literal("assign"),
    leadId: z.uuid(),
    memberIds: z.array(z.uuid()).max(L.teamMax).default([]),
    dueOn: isoDate.optional(),
    instructions: optionalText(L.instructionsMax),
  }),
  z.object({
    to: z.literal("act"),
    actions: z.array(actionInput).min(1).max(L.recommendationsMax),
  }),
  z.object({
    to: z.literal("close"),
    summary: trimmed(L.closureMin, L.closureMax),
    noFurtherAction: z.boolean().default(false),
  }),
  z.object({
    to: z.literal("reassign"),
    leadId: z.uuid().optional(),
    memberIds: z.array(z.uuid()).max(L.teamMax).optional(),
    reason: optionalText(L.reasonMax),
  }),
  z.object({ to: z.literal("complete_investigation") }),
  z.object({
    to: z.literal("return"),
    reason: trimmed(L.reasonMin, L.returnReasonMax),
  }),
  z.object({
    to: z.literal("void"),
    kind: z.enum(SAFETY_VOID_KINDS),
    reason: trimmed(L.reasonMin, L.reasonMax),
    duplicateOf: z.uuid().optional(),
  }),
]);
export type SafetyEventTransitionRequest = z.input<
  typeof safetyEventTransitionRequestSchema
>;

export const safetyPeopleRequestSchema = z.object({
  people: z.array(safetyPersonSchema).max(L.peopleMax),
});
export type SafetyPeopleRequest = z.input<typeof safetyPeopleRequestSchema>;

export const createWitnessRequestSchema = reportWitnessSchema;
export type CreateWitnessRequest = z.input<typeof createWitnessRequestSchema>;

export const updateWitnessRequestSchema = z.object({
  company: optionalText(L.companyMax),
  contact: optionalText(L.contactMax),
  statement: optionalText(L.statementMax),
  statementOn: isoDate.nullable().optional(),
  baseVersion: z.number().int().min(1).optional(),
});
export type UpdateWitnessRequest = z.input<typeof updateWitnessRequestSchema>;

export const reasonRequestSchema = z.object({
  reason: trimmed(L.reasonMin, L.reasonMax),
});

export const investigationRequestSchema = z.object({
  sequenceOfEvents: optionalText(L.investigationTextMax),
  lessonsLearned: optionalText(L.investigationTextMax),
  baseVersion: z.number().int().min(1),
});
export type InvestigationRequest = z.input<typeof investigationRequestSchema>;

export const causesRequestSchema = z.object({
  kind: z.enum(CAUSE_KINDS),
  items: z
    .array(
      z.object({
        categoryId: z.uuid().nullable().optional(),
        description: trimmed(3, L.causeTextMax),
        whys: z.array(trimmed(1, L.whyMax)).max(L.whysMax).default([]),
      }),
    )
    .max(L.causesMax),
  baseVersion: z.number().int().min(1),
});
export type CausesRequest = z.input<typeof causesRequestSchema>;

export const recommendationRequestSchema = z.object({
  kind: z.enum(["corrective", "preventive", "improvement"]),
  description: trimmed(5, L.causeTextMax),
});
export type RecommendationRequest = z.input<typeof recommendationRequestSchema>;

export const raiseRecommendationActionRequestSchema = actionInput;
export type RaiseRecommendationActionRequest = z.input<
  typeof raiseRecommendationActionRequestSchema
>;

export const addendumActionRequestSchema = actionInput.extend({
  recommendation: trimmed(5, L.causeTextMax),
});
export type AddendumActionRequest = z.input<typeof addendumActionRequestSchema>;

const listNames = z
  .object({
    nameEn: optionalText(L.listNameMax),
    nameAr: optionalText(L.listNameMax),
  })
  .superRefine((value, ctx) => {
    const names = [value.nameEn, value.nameAr].filter((n): n is string =>
      Boolean(n),
    );
    if (names.length === 0)
      ctx.addIssue({ code: "custom", path: ["nameEn"], message: "required" });
    if (names.some((n) => n.length < L.listNameMin))
      ctx.addIssue({ code: "custom", path: ["nameEn"], message: "tooShort" });
  });

export const safetyListItemRequestSchema = listNames;
export type SafetyListItemRequest = z.input<typeof safetyListItemRequestSchema>;

export const eventTypeRequestSchema = z.intersection(
  listNames,
  z.object({
    family: z.enum(SAFETY_EVENT_FAMILIES),
    investigation: z.enum(INVESTIGATION_RULES),
    minSeverity: z.enum(SAFETY_SEVERITIES).nullable().default(null),
    injuryDetails: z.boolean().default(false),
    areaRequired: z.boolean().default(false),
    riskRating: z.enum(RISK_RATING_RULES).default("optional"),
  }),
);
export type EventTypeRequest = z.input<typeof eventTypeRequestSchema>;

export const SAFETY_EVENT_FILTERS = [
  "open",
  "critical_high",
  "to_review",
  "overdue",
  "verification",
  "mine",
] as const;

export const safetyEventListQuerySchema = z.object({
  filter: z.enum(SAFETY_EVENT_FILTERS).optional(),
  status: z.enum(SAFETY_EVENT_STATUSES).optional(),
  type: z.uuid().optional(),
  family: z.enum(SAFETY_EVENT_FAMILIES).optional(),
  severity: z.enum(SAFETY_SEVERITIES).optional(),
  place: z.uuid().optional(),
  voided: bool,
  search: z.string().trim().max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type SafetyEventListQuery = z.output<typeof safetyEventListQuerySchema>;

export const MY_SAFETY_EVENT_TABS = [
  "reported",
  "investigating",
  "to_review",
  "to_close",
] as const;
export type MySafetyEventTab = (typeof MY_SAFETY_EVENT_TABS)[number];

export const mySafetyEventsQuerySchema = z.object({
  tab: z.enum(MY_SAFETY_EVENT_TABS).default("reported"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MySafetyEventsQuery = z.output<typeof mySafetyEventsQuerySchema>;

// ---- Responses ---------------------------------------------------------------------------

export interface SafetyPersonRefDto {
  id: string;
  name: string;
}

export interface SafetyEventTypeDto {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  family: SafetyEventFamily;
  investigation: InvestigationRule;
  minSeverity: SafetySeverity | null;
  injuryDetails: boolean;
  areaRequired: boolean;
  riskRating: RiskRatingRule;
  active: boolean;
  position: number;
  inUse: boolean;
}

export interface SafetyListItemDto {
  id: string;
  list: SafetyList;
  nameEn: string | null;
  nameAr: string | null;
  active: boolean;
  position: number;
  inUse: boolean;
}

export interface SafetySettingsDto {
  types: SafetyEventTypeDto[];
  lists: Record<SafetyList, SafetyListItemDto[]>;
  canManage: boolean;
}

/** T-90: what the report screen needs offline. */
export interface SafetySettingsPackDto {
  types: SafetyEventTypeDto[];
  categories: SafetyListItemDto[];
  generatedAt: number;
}

export interface SafetyRiskDto {
  matrixVersion: number;
  likelihood: number;
  consequence: number;
  score: number;
  bandKey: RiskBandKey;
  bandLabel: RiskText;
}

export interface SafetyEventFileDto {
  id: string;
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sensitive: boolean;
  witnessId: string | null;
  uploadedBy: SafetyPersonRefDto | null;
  uploadedAt: number;
  canRemove: boolean;
}

export interface SafetyPersonDto {
  id: string;
  role: PersonRole;
  name: string;
  workforceMemberId: string | null;
  userId: string | null;
  injuryNature: InjuryNature | null;
  bodyPart: BodyPart | null;
  treatment: Treatment | null;
  daysLost: number | null;
  detail: string | null;
}

export interface SafetyWitnessDto {
  id: string;
  name: string;
  company: string | null;
  workforceMemberId: string | null;
  userId: string | null;
  /** null for readers who can't see the contact and statement (T-93). */
  contact: string | null;
  statement: string | null;
  statementOn: string | null;
  takenBy: SafetyPersonRefDto | null;
  hasStatement: boolean;
  restricted: boolean;
  canEditStatement: boolean;
  version: number;
}

export interface SafetyCauseDto {
  id: string;
  kind: CauseKind;
  categoryId: string | null;
  categoryEn: string | null;
  categoryAr: string | null;
  description: string;
  whys: string[];
}

export interface SafetyRecommendationActionDto {
  id: string;
  reference: string;
  status: string;
  voided: boolean;
  ownerName: string | null;
  dueOn: string;
}

export interface SafetyRecommendationDto {
  id: string;
  seq: number;
  kind: RecommendationKind;
  description: string;
  status: RecommendationStatus;
  noActionReason: string | null;
  addendum: boolean;
  actions: SafetyRecommendationActionDto[];
}

export interface SafetyInvestigationDto {
  lead: SafetyPersonRefDto | null;
  members: SafetyPersonRefDto[];
  dueOn: string;
  overdueDays: number;
  instructions: string | null;
  sequenceOfEvents: string | null;
  lessonsLearned: string | null;
  assignedAt: number;
  completedAt: number | null;
  causes: SafetyCauseDto[];
  version: number;
}

export interface SafetyEventSummaryDto {
  id: string;
  projectId: string;
  projectCode: string;
  number: number;
  reference: string | null;
  typeId: string;
  typeNameEn: string | null;
  typeNameAr: string | null;
  family: SafetyEventFamily;
  title: string;
  status: SafetyEventStatus;
  severity: SafetySeverity | null;
  reportedSeverity: SafetySeverity;
  riskBandKey: RiskBandKey | null;
  riskBandLabel: RiskText | null;
  occurredAt: number;
  reportedLate: boolean;
  placeName: string | null;
  reportedBy: SafetyPersonRefDto | null;
  underReview: boolean;
  voided: boolean;
  investigationOverdueDays: number;
  urgent: boolean;
  version: number;
}

export interface SafetyEventAccessDto {
  reporter: boolean;
  viewer: boolean;
  team: boolean;
  lead: boolean;
  manage: boolean;
  close: boolean;
  sensitive: boolean;
}

export interface SafetyEventDto extends SafetyEventSummaryDto {
  description: string;
  categoryIds: string[];
  categories: { id: string; nameEn: string | null; nameAr: string | null }[];
  areaId: string | null;
  locationId: string | null;
  workZoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  immediateAction: string | null;
  potentialOutcome: string | null;
  damageDetails: string | null;
  environmentDetails: string | null;
  risk: SafetyRiskDto | null;
  investigationRequired: boolean;
  reviewNote: string | null;
  reviewedBy: SafetyPersonRefDto | null;
  selfReviewed: boolean;
  voidKind: SafetyVoidKind | null;
  voidReason: string | null;
  closureKind: ClosureKind | null;
  closureSummary: string | null;
  closedAt: number | null;
  closedBy: SafetyPersonRefDto | null;
  followUpOf: string | null;
  offline: boolean;
  capturedAt: number | null;
  receivedAt: number;
  /** Sensitive parts: null when the reader may not see them (T-92). */
  people: SafetyPersonDto[] | null;
  peopleCount: number;
  injuredCount: number;
  witnesses: SafetyWitnessDto[];
  files: SafetyEventFileDto[];
  investigation: SafetyInvestigationDto | null;
  recommendations: SafetyRecommendationDto[] | null;
  access: SafetyEventAccessDto;
  transitions: SafetyEventTransition[];
  canEditReport: boolean;
  canClassify: boolean;
  canEditInvestigation: boolean;
  canRaiseActions: boolean;
  canAddWitness: boolean;
  canEditPeople: boolean;
  canComment: boolean;
}

export interface SafetyEventCountsDto {
  open: number;
  criticalHigh: number;
  toReview: number;
  overdueInvestigations: number;
  verification: number;
}

export interface SafetyEventPageDto {
  items: SafetyEventSummaryDto[];
  total: number;
  counts: SafetyEventCountsDto;
  canReport: boolean;
  canViewAll: boolean;
}

export interface MySafetyEventsPageDto {
  items: SafetyEventSummaryDto[];
  total: number;
  counts: Record<MySafetyEventTab, number>;
}

/** The reporter's projection (O-167). */
export function isUnderReview(
  event: Pick<SafetyEventSummaryDto, "status" | "underReview">,
): boolean {
  return event.status === "reported" && event.underReview;
}
