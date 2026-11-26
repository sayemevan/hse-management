import {
  ACTION_PRIORITIES,
  ACTION_STATUSES,
  ACTION_TYPES,
  ACTION_UPDATE_KINDS,
  VERIFICATION_METHODS,
} from '@hse/shared';
import {
  index,
  integer,
  primaryKey as compositeKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { primaryKey } from '../../database/columns';
import { place, project } from '../project';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/**
 * One row per action, for every source module (PLT-23, T-57). Never deleted (Doc 13 §16):
 * mistakes are voided (O-106). `owner_id` is kept here for "My actions"; every change is also
 * in `action_owner_history` (T-61).
 */
export const action = sqliteTable(
  'action',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id),
    number: integer('number').notNull(),
    sourceModule: text('source_module').notNull(),
    sourceRecordId: text('source_record_id'),
    sourceLabel: text('source_label').notNull(),
    type: text('type', { enum: ACTION_TYPES }).notNull(),
    priority: text('priority', { enum: ACTION_PRIORITIES }).notNull(),
    status: text('status', { enum: ACTION_STATUSES }).notNull(),
    title: text('title').notNull(),
    /** T-52 normalised title, for search. */
    searchKey: text('search_key').notNull(),
    description: text('description'),
    ownerId: text('owner_id').notNull(),
    dueOn: text('due_on').notNull(),
    areaId: text('area_id').references(() => place.id),
    locationId: text('location_id').references(() => place.id),
    workZoneId: text('work_zone_id').references(() => place.id),
    progressPercent: integer('progress_percent'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    completedOnTime: integer('completed_on_time', { mode: 'boolean' }),
    verifiedAt: timestamp('verified_at'),
    verifiedBy: text('verified_by'),
    verificationMethod: text('verification_method', { enum: VERIFICATION_METHODS }),
    closedAt: timestamp('closed_at'),
    closedBy: text('closed_by'),
    sendBackCount: integer('send_back_count').notNull().default(0),
    voidedAt: timestamp('voided_at'),
    voidedBy: text('voided_by'),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (table) => [
    uniqueIndex('action_number_unique').on(table.projectId, table.number),
    index('action_project_status_idx').on(table.projectId, table.status, table.dueOn),
    index('action_owner_idx').on(table.companyId, table.ownerId, table.status, table.dueOn),
    index('action_source_idx').on(table.projectId, table.sourceModule, table.sourceRecordId),
    index('action_due_idx').on(table.status, table.dueOn),
    index('action_area_idx').on(table.areaId),
    index('action_location_idx').on(table.locationId),
    index('action_work_zone_idx').on(table.workZoneId),
  ],
);

export type ActionRow = typeof action.$inferSelect;

/** T-61: every owner an action has had. `to_at` is null for the current owner. */
export const actionOwnerHistory = sqliteTable(
  'action_owner_history',
  {
    ...primaryKey(),
    actionId: text('action_id')
      .notNull()
      .references(() => action.id),
    ownerId: text('owner_id').notNull(),
    fromAt: timestamp('from_at').notNull(),
    toAt: timestamp('to_at'),
    assignedBy: text('assigned_by'),
    reason: text('reason'),
  },
  (table) => [index('action_owner_history_action_idx').on(table.actionId, table.fromAt)],
);

export type ActionOwnerHistoryRow = typeof actionOwnerHistory.$inferSelect;

/** O-102: collaborators. Removed, never deleted. */
export const actionCollaborator = sqliteTable(
  'action_collaborator',
  {
    ...primaryKey(),
    actionId: text('action_id')
      .notNull()
      .references(() => action.id),
    userId: text('user_id').notNull(),
    addedAt: timestamp('added_at').notNull(),
    addedBy: text('added_by'),
    removedAt: timestamp('removed_at'),
    removedBy: text('removed_by'),
  },
  (table) => [
    index('action_collaborator_action_idx').on(table.actionId, table.removedAt),
    index('action_collaborator_user_idx').on(table.userId, table.removedAt),
  ],
);

export type ActionCollaboratorRow = typeof actionCollaborator.$inferSelect;

/** T-62: immutable notes (database triggers refuse UPDATE and DELETE, migration 0013). */
export const actionUpdate = sqliteTable(
  'action_update',
  {
    ...primaryKey(),
    actionId: text('action_id')
      .notNull()
      .references(() => action.id),
    kind: text('kind', { enum: ACTION_UPDATE_KINDS }).notNull(),
    note: text('note'),
    percent: integer('percent'),
    method: text('method', { enum: VERIFICATION_METHODS }),
    /** JSON array of the action files this note shows (progress photos, completion evidence). */
    fileIds: text('file_ids').notNull().default('[]'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [index('action_update_action_idx').on(table.actionId, table.createdAt)],
);

export type ActionUpdateRow = typeof actionUpdate.$inferSelect;

/** T-62: files of an action (category `action_evidence`). Updates list the ones they show. */
export const actionFile = sqliteTable(
  'action_file',
  {
    actionId: text('action_id')
      .notNull()
      .references(() => action.id),
    fileId: text('file_id').notNull(),
    kind: text('kind', { enum: ['evidence', 'attachment'] }).notNull(),
    addedBy: text('added_by').notNull(),
    addedAt: timestamp('added_at').notNull(),
  },
  (table) => [compositeKey({ columns: [table.actionId, table.fileId] })],
);

export type ActionFileRow = typeof actionFile.$inferSelect;
