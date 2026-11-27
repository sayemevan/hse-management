import {
  BODY_PARTS,
  CAUSE_KINDS,
  CLOSURE_KINDS,
  INJURY_NATURES,
  INVESTIGATION_RULES,
  PERSON_ROLES,
  RECOMMENDATION_KINDS,
  RECOMMENDATION_STATUSES,
  RISK_BAND_KEYS,
  RISK_RATING_RULES,
  type RiskText,
  SAFETY_EVENT_FAMILIES,
  SAFETY_EVENT_STATUSES,
  SAFETY_LISTS,
  SAFETY_SEVERITIES,
  SAFETY_VOID_KINDS,
  TREATMENTS,
} from "@hse/shared";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { primaryKey } from "../../database/columns";
import { place, project } from "../project";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const audit = () => ({
  createdAt: timestamp("created_at").notNull(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

/** O-164 (T-85): company event types with their rules. Never deleted once used. */
export const safetyEventType = sqliteTable(
  "safety_event_type",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    nameEn: text("name_en"),
    nameAr: text("name_ar"),
    nameKeyEn: text("name_key_en"),
    nameKeyAr: text("name_key_ar"),
    family: text("family", { enum: SAFETY_EVENT_FAMILIES }).notNull(),
    investigation: text("investigation", {
      enum: INVESTIGATION_RULES,
    }).notNull(),
    minSeverity: text("min_severity", { enum: SAFETY_SEVERITIES }),
    injuryDetails: integer("injury_details", { mode: "boolean" })
      .notNull()
      .default(false),
    areaRequired: integer("area_required", { mode: "boolean" })
      .notNull()
      .default(false),
    riskRating: text("risk_rating", { enum: RISK_RATING_RULES }).notNull(),
    position: integer("position").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    deactivatedAt: timestamp("deactivated_at"),
    seedKey: text("seed_key"),
    ...audit(),
  },
  (table) => [
    index("safety_event_type_company_idx").on(table.companyId, table.position),
    uniqueIndex("safety_event_type_seed_unique").on(
      table.companyId,
      table.seedKey,
    ),
  ],
);

/** O-165, O-171: the company lists of the module (categories, immediate and root causes). */
export const safetyListItem = sqliteTable(
  "safety_list_item",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    list: text("list", { enum: SAFETY_LISTS }).notNull(),
    nameEn: text("name_en"),
    nameAr: text("name_ar"),
    nameKeyEn: text("name_key_en"),
    nameKeyAr: text("name_key_ar"),
    position: integer("position").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    seedKey: text("seed_key"),
    ...audit(),
  },
  (table) => [
    index("safety_list_item_company_idx").on(
      table.companyId,
      table.list,
      table.position,
    ),
    uniqueIndex("safety_list_item_seed_unique").on(
      table.companyId,
      table.list,
      table.seedKey,
    ),
  ],
);

/** PLT-33: one event of a project, whatever its type (T-84). Never deleted (a trigger refuses it). */
export const safetyEvent = sqliteTable(
  "safety_event",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    number: integer("number").notNull(),
    typeId: text("type_id")
      .notNull()
      .references(() => safetyEventType.id),
    family: text("family", { enum: SAFETY_EVENT_FAMILIES }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    reportedLate: integer("reported_late", { mode: "boolean" })
      .notNull()
      .default(false),
    areaId: text("area_id").references(() => place.id),
    locationId: text("location_id").references(() => place.id),
    workZoneId: text("work_zone_id").references(() => place.id),
    latitude: real("latitude"),
    longitude: real("longitude"),
    locationAccuracyM: real("location_accuracy_m"),
    reportedBy: text("reported_by").notNull(),
    reportedSeverity: text("reported_severity", {
      enum: SAFETY_SEVERITIES,
    }).notNull(),
    severity: text("severity", { enum: SAFETY_SEVERITIES }),
    immediateAction: text("immediate_action"),
    potentialOutcome: text("potential_outcome"),
    damageDetails: text("damage_details"),
    environmentDetails: text("environment_details"),
    riskMatrixVersion: integer("risk_matrix_version"),
    riskLikelihood: integer("risk_likelihood"),
    riskConsequence: integer("risk_consequence"),
    riskScore: integer("risk_score"),
    riskBand: text("risk_band", { enum: RISK_BAND_KEYS }),
    riskBandLabel: text("risk_band_label", { mode: "json" }).$type<RiskText>(),
    status: text("status", { enum: SAFETY_EVENT_STATUSES }).notNull(),
    investigationRequired: integer("investigation_required", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    reviewStartedAt: timestamp("review_started_at"),
    reviewStartedBy: text("review_started_by"),
    reviewedAt: timestamp("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    reviewNote: text("review_note"),
    selfReviewed: integer("self_reviewed", { mode: "boolean" })
      .notNull()
      .default(false),
    voidedAt: timestamp("voided_at"),
    voidedBy: text("voided_by"),
    voidKind: text("void_kind", { enum: SAFETY_VOID_KINDS }),
    voidReason: text("void_reason"),
    duplicateOf: text("duplicate_of"),
    closedAt: timestamp("closed_at"),
    closedBy: text("closed_by"),
    closureKind: text("closure_kind", { enum: CLOSURE_KINDS }),
    closureSummary: text("closure_summary"),
    followUpOf: text("follow_up_of"),
    offline: integer("offline", { mode: "boolean" }).notNull().default(false),
    deviceId: text("device_id"),
    capturedAt: timestamp("captured_at"),
    receivedAt: timestamp("received_at").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("safety_event_number_unique").on(table.projectId, table.number),
    index("safety_event_project_status_idx").on(
      table.projectId,
      table.status,
      table.severity,
    ),
    index("safety_event_reporter_idx").on(
      table.companyId,
      table.reportedBy,
      table.status,
    ),
    index("safety_event_type_idx").on(table.projectId, table.typeId),
    index("safety_event_area_idx").on(table.areaId),
    index("safety_event_location_idx").on(table.locationId),
    index("safety_event_work_zone_idx").on(table.workZoneId),
  ],
);

/** 1–3 categories per event (O-165). */
export const safetyEventCategoryLink = sqliteTable(
  "safety_event_category_link",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => safetyEvent.id),
    categoryId: text("category_id")
      .notNull()
      .references(() => safetyListItem.id),
    companyId: text("company_id").notNull(),
  },
  (table) => [
    uniqueIndex("safety_event_category_unique").on(
      table.eventId,
      table.categoryId,
    ),
    index("safety_event_category_item_idx").on(table.categoryId),
  ],
);

/** US-041, US-042 (T-92): people injured or involved. Sensitive. */
export const safetyEventPerson = sqliteTable(
  "safety_event_person",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => safetyEvent.id),
    workforceMemberId: text("workforce_member_id"),
    userId: text("user_id"),
    name: text("name").notNull(),
    role: text("role", { enum: PERSON_ROLES }).notNull(),
    injuryNature: text("injury_nature", { enum: INJURY_NATURES }),
    bodyPart: text("body_part", { enum: BODY_PARTS }),
    treatment: text("treatment", { enum: TREATMENTS }),
    daysLost: integer("days_lost"),
    detail: text("detail"),
    removedAt: timestamp("removed_at"),
    removedBy: text("removed_by"),
    ...audit(),
  },
  (table) => [index("safety_event_person_event_idx").on(table.eventId)],
);

/** US-045: witnesses and their statements. */
export const safetyEventWitness = sqliteTable(
  "safety_event_witness",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => safetyEvent.id),
    workforceMemberId: text("workforce_member_id"),
    userId: text("user_id"),
    name: text("name").notNull(),
    company: text("company"),
    contact: text("contact"),
    statement: text("statement"),
    statementOn: text("statement_on"),
    takenBy: text("taken_by"),
    removedAt: timestamp("removed_at"),
    removedBy: text("removed_by"),
    removeReason: text("remove_reason"),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [index("safety_event_witness_event_idx").on(table.eventId)],
);

/** US-043, US-044 (T-88): the investigation, 1:1 with the event. */
export const safetyEventInvestigation = sqliteTable(
  "safety_event_investigation",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => safetyEvent.id),
    leadId: text("lead_id").notNull(),
    dueOn: text("due_on").notNull(),
    instructions: text("instructions"),
    sequenceOfEvents: text("sequence_of_events"),
    lessonsLearned: text("lessons_learned"),
    assignedAt: timestamp("assigned_at").notNull(),
    assignedBy: text("assigned_by").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    completedBy: text("completed_by"),
    version: integer("version").notNull().default(1),
    ...audit(),
  },
  (table) => [
    uniqueIndex("safety_event_investigation_event_unique").on(table.eventId),
  ],
);

/** Up to 5 team members besides the lead (O-170). */
export const safetyEventInvestigationMember = sqliteTable(
  "safety_event_investigation_member",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    investigationId: text("investigation_id")
      .notNull()
      .references(() => safetyEventInvestigation.id),
    userId: text("user_id").notNull(),
    addedAt: timestamp("added_at").notNull(),
    addedBy: text("added_by").notNull(),
    removedAt: timestamp("removed_at"),
    removedBy: text("removed_by"),
  },
  (table) => [
    index("safety_event_member_idx").on(table.investigationId, table.userId),
  ],
);

/** US-044: immediate causes, root causes (5 Whys) and contributing factors. */
export const safetyEventCause = sqliteTable(
  "safety_event_cause",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => safetyEvent.id),
    kind: text("kind", { enum: CAUSE_KINDS }).notNull(),
    categoryId: text("category_id").references(() => safetyListItem.id),
    description: text("description").notNull(),
    whys: text("whys", { mode: "json" }).$type<string[]>().notNull(),
    position: integer("position").notNull(),
    removedAt: timestamp("removed_at"),
    ...audit(),
  },
  (table) => [
    index("safety_event_cause_event_idx").on(table.eventId, table.kind),
  ],
);

/** T-89: every action of an event belongs to a recommendation. */
export const safetyEventRecommendation = sqliteTable(
  "safety_event_recommendation",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    projectId: text("project_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => safetyEvent.id),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: RECOMMENDATION_KINDS }).notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: RECOMMENDATION_STATUSES }).notNull(),
    noActionReason: text("no_action_reason"),
    addendum: integer("addendum", { mode: "boolean" }).notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    ...audit(),
  },
  (table) => [
    uniqueIndex("safety_event_recommendation_seq_unique").on(
      table.eventId,
      table.seq,
    ),
  ],
);

/** US-040, US-042, US-045: evidence and sensitive files, on the event or a witness. */
export const safetyEventFile = sqliteTable(
  "safety_event_file",
  {
    ...primaryKey(),
    companyId: text("company_id").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => safetyEvent.id),
    fileId: text("file_id").notNull(),
    sensitive: integer("sensitive", { mode: "boolean" })
      .notNull()
      .default(false),
    witnessId: text("witness_id"),
    capturedAt: timestamp("captured_at").notNull(),
    removedAt: timestamp("removed_at"),
    removedBy: text("removed_by"),
    createdAt: timestamp("created_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (table) => [index("safety_event_file_event_idx").on(table.eventId)],
);

export type SafetyEventTypeRow = typeof safetyEventType.$inferSelect;
export type SafetyListItemRow = typeof safetyListItem.$inferSelect;
export type SafetyEventRow = typeof safetyEvent.$inferSelect;
export type SafetyEventPersonRow = typeof safetyEventPerson.$inferSelect;
export type SafetyEventWitnessRow = typeof safetyEventWitness.$inferSelect;
export type SafetyEventInvestigationRow =
  typeof safetyEventInvestigation.$inferSelect;
export type SafetyEventMemberRow =
  typeof safetyEventInvestigationMember.$inferSelect;
export type SafetyEventCauseRow = typeof safetyEventCause.$inferSelect;
export type SafetyEventRecommendationRow =
  typeof safetyEventRecommendation.$inferSelect;
export type SafetyEventFileRow = typeof safetyEventFile.$inferSelect;
