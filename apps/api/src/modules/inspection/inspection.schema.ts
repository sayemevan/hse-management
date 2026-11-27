import {
  FINDING_DECISIONS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  INSPECTION_RESULTS,
  INSPECTION_STATUSES,
  INSPECTION_WEATHER,
  type TemplateContent,
} from '@hse/shared';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';
import { place, project } from '../project';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** O-141: the company's inspection categories, seeded with the Doc 10 §3 types. */
export const inspectionCategory = sqliteTable(
  'inspection_category',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    nameEn: text('name_en'),
    nameAr: text('name_ar'),
    /** Lower-cased trimmed names, `en|ar`, for uniqueness in either language. */
    nameKeyEn: text('name_key_en'),
    nameKeyAr: text('name_key_ar'),
    position: integer('position').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    seedKey: text('seed_key'),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by'),
    updatedAt: timestamp('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (table) => [
    index('inspection_category_company_idx').on(table.companyId, table.position),
    uniqueIndex('inspection_category_seed_unique').on(table.companyId, table.seedKey),
  ],
);

/** US-031: template identity. Never deleted once published (US-032). */
export const inspectionTemplate = sqliteTable(
  'inspection_template',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => inspectionCategory.id),
    nameEn: text('name_en'),
    nameAr: text('name_ar'),
    nameKeyEn: text('name_key_en'),
    nameKeyAr: text('name_key_ar'),
    status: text('status', { enum: ['active', 'retired'] }).notNull(),
    currentVersionId: text('current_version_id'),
    retiredAt: timestamp('retired_at'),
    retiredBy: text('retired_by'),
    seedKey: text('seed_key'),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by'),
    updatedAt: timestamp('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (table) => [
    index('inspection_template_company_idx').on(table.companyId, table.status),
    uniqueIndex('inspection_template_seed_unique').on(table.companyId, table.seedKey),
  ],
);

/**
 * T-76: the content of one version. Published and superseded rows never change (a trigger
 * refuses it); at most one draft per template.
 */
export const inspectionTemplateVersion = sqliteTable(
  'inspection_template_version',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    templateId: text('template_id')
      .notNull()
      .references(() => inspectionTemplate.id),
    versionNo: integer('version_no').notNull(),
    state: text('state', { enum: ['draft', 'published', 'superseded'] }).notNull(),
    content: text('content', { mode: 'json' }).$type<TemplateContent>().notNull(),
    itemCount: integer('item_count').notNull(),
    publishedAt: timestamp('published_at'),
    publishedBy: text('published_by'),
    supersededAt: timestamp('superseded_at'),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by'),
    updatedAt: timestamp('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (table) => [
    uniqueIndex('inspection_template_version_no_unique').on(table.templateId, table.versionNo),
    uniqueIndex('inspection_template_one_draft')
      .on(table.templateId)
      .where(sql`state = 'draft'`),
  ],
);

/** PLT-32: one inspection of a project, pinned to one template version (T-77). */
export const inspection = sqliteTable(
  'inspection',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id),
    number: integer('number').notNull(),
    templateId: text('template_id')
      .notNull()
      .references(() => inspectionTemplate.id),
    templateVersionId: text('template_version_id')
      .notNull()
      .references(() => inspectionTemplateVersion.id),
    status: text('status', { enum: INSPECTION_STATUSES }).notNull(),
    cancelledAt: timestamp('cancelled_at'),
    cancelledBy: text('cancelled_by'),
    cancelReason: text('cancel_reason'),
    inspectorId: text('inspector_id').notNull(),
    plannedBy: text('planned_by'),
    plannedOn: text('planned_on'),
    note: text('note'),
    areaId: text('area_id').references(() => place.id),
    locationId: text('location_id').references(() => place.id),
    workZoneId: text('work_zone_id').references(() => place.id),
    inspectedOn: text('inspected_on'),
    weather: text('weather', { enum: INSPECTION_WEATHER }),
    notes: text('notes'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    locationAccuracyM: real('location_accuracy_m'),
    startedAt: timestamp('started_at'),
    submittedAt: timestamp('submitted_at'),
    submitCount: integer('submit_count').notNull().default(0),
    reviewStartedAt: timestamp('review_started_at'),
    reviewStartedBy: text('review_started_by'),
    approvedAt: timestamp('approved_at'),
    approvedBy: text('approved_by'),
    approvedOnSubmit: integer('approved_on_submit', { mode: 'boolean' }).notNull().default(false),
    closedAt: timestamp('closed_at'),
    scorePercent: real('score_percent'),
    scoreOutcome: text('score_outcome', { enum: ['pass', 'fail'] }),
    followUpOf: text('follow_up_of'),
    offline: integer('offline', { mode: 'boolean' }).notNull().default(false),
    deviceId: text('device_id'),
    capturedAt: timestamp('captured_at'),
    receivedAt: timestamp('received_at').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (table) => [
    uniqueIndex('inspection_number_unique').on(table.projectId, table.number),
    index('inspection_project_status_idx').on(table.projectId, table.status, table.plannedOn),
    index('inspection_inspector_idx').on(table.companyId, table.inspectorId, table.status),
    index('inspection_template_idx').on(table.projectId, table.templateId),
    index('inspection_version_idx').on(table.templateVersionId),
    index('inspection_open_idx').on(table.status, table.plannedOn),
    index('inspection_area_idx').on(table.areaId),
    index('inspection_location_idx').on(table.locationId),
    index('inspection_work_zone_idx').on(table.workZoneId),
  ],
);

/** US-034: one row per answered item key, versioned on its own (T-77). */
export const inspectionItemResult = sqliteTable(
  'inspection_item_result',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    inspectionId: text('inspection_id')
      .notNull()
      .references(() => inspection.id),
    itemKey: text('item_key').notNull(),
    result: text('result', { enum: INSPECTION_RESULTS }),
    comment: text('comment'),
    priority: text('priority', { enum: FINDING_SEVERITIES }),
    assignedTo: text('assigned_to'),
    raiseFinding: integer('raise_finding', { mode: 'boolean' }).notNull().default(false),
    capturedAt: timestamp('captured_at'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (table) => [uniqueIndex('inspection_item_unique').on(table.inspectionId, table.itemKey)],
);

/** US-035: evidence on the inspection or one item. Removed only before submit (soft). */
export const inspectionFile = sqliteTable(
  'inspection_file',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    inspectionId: text('inspection_id')
      .notNull()
      .references(() => inspection.id),
    itemKey: text('item_key'),
    fileId: text('file_id').notNull(),
    capturedAt: timestamp('captured_at').notNull(),
    /** The submit count when it was first submitted; null before (US-035 FR-4). */
    submittedWith: integer('submitted_with'),
    removedAt: timestamp('removed_at'),
    removedBy: text('removed_by'),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by').notNull(),
  },
  (table) => [index('inspection_file_item_idx').on(table.inspectionId, table.itemKey)],
);

/** US-039: findings; actions link back through the action source (T-79). */
export const inspectionFinding = sqliteTable(
  'inspection_finding',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    projectId: text('project_id').notNull(),
    inspectionId: text('inspection_id')
      .notNull()
      .references(() => inspection.id),
    itemKey: text('item_key').notNull(),
    seq: integer('seq').notNull(),
    description: text('description').notNull(),
    severity: text('severity', { enum: FINDING_SEVERITIES }).notNull(),
    categoryEn: text('category_en'),
    categoryAr: text('category_ar'),
    responsibleId: text('responsible_id'),
    dueOn: text('due_on').notNull(),
    status: text('status', { enum: FINDING_STATUSES }).notNull(),
    decision: text('decision', { enum: FINDING_DECISIONS }),
    noActionReason: text('no_action_reason'),
    editedBy: text('edited_by'),
    editedAt: timestamp('edited_at'),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (table) => [
    uniqueIndex('inspection_finding_item_unique').on(table.inspectionId, table.itemKey),
    index('inspection_finding_project_idx').on(table.projectId, table.status, table.severity),
  ],
);

export type InspectionCategoryRow = typeof inspectionCategory.$inferSelect;
export type InspectionTemplateRow = typeof inspectionTemplate.$inferSelect;
export type InspectionTemplateVersionRow = typeof inspectionTemplateVersion.$inferSelect;
export type InspectionRow = typeof inspection.$inferSelect;
export type InspectionItemResultRow = typeof inspectionItemResult.$inferSelect;
export type InspectionFileRow = typeof inspectionFile.$inferSelect;
export type InspectionFindingRow = typeof inspectionFinding.$inferSelect;
