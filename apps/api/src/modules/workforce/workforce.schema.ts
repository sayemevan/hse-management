import {
  CONTACT_RELATIONSHIPS,
  RECORD_KINDS,
  WORKFORCE_CATEGORIES,
  WORKFORCE_LISTS,
  WORKFORCE_STATUSES,
} from '@hse/shared';
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { auditColumns, primaryKey } from '../../database/columns';
import { project } from '../project';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/**
 * Job positions and competencies of a company (PLT-21, T-54). Seeded items keep `seed_key`
 * until renamed. Names are unique in a list ignoring case.
 */
export const workforceListItem = sqliteTable(
  'workforce_list_item',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    list: text('list', { enum: WORKFORCE_LISTS }).notNull(),
    seedKey: text('seed_key'),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    position: integer('position').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('workforce_list_item_name_unique').on(table.companyId, table.list, table.nameKey),
    uniqueIndex('workforce_list_item_seed_unique').on(table.companyId, table.list, table.seedKey),
    index('workforce_list_item_order_idx').on(
      table.companyId,
      table.list,
      table.active,
      table.position,
    ),
  ],
);

/** One profile per person, every category (US-024, T-47). Archived, never deleted (O-79). */
export const workforceMember = sqliteTable(
  'workforce_member',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    category: text('category', { enum: WORKFORCE_CATEGORIES }).notNull(),
    fullName: text('full_name').notNull(),
    altName: text('alt_name'),
    employeeId: text('employee_id'),
    employeeIdKey: text('employee_id_key'),
    nationality: text('nationality').notNull(),
    employer: text('employer').notNull(),
    jobPositionId: text('job_position_id')
      .notNull()
      .references(() => workforceListItem.id),
    department: text('department'),
    mobile: text('mobile'),
    email: text('email'),
    // No database foreign key, as `company.logo_file_id` (D-39).
    photoFileId: text('photo_file_id'),
    status: text('status', { enum: WORKFORCE_STATUSES }).notNull(),
    statusSince: text('status_since').notNull(),
    statusReason: text('status_reason'),
    /** T-52: names, employee ID and employer, normalised. */
    searchKey: text('search_key').notNull(),
    archivedAt: timestamp('archived_at'),
    archivedBy: text('archived_by'),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('workforce_member_employee_id_unique').on(table.companyId, table.employeeIdKey),
    index('workforce_member_status_idx').on(table.companyId, table.archivedAt, table.status),
    index('workforce_member_category_idx').on(table.companyId, table.category),
    index('workforce_member_position_idx').on(table.companyId, table.jobPositionId),
    index('workforce_member_nationality_idx').on(table.companyId, table.nationality),
    index('workforce_member_name_idx').on(table.companyId, table.fullName),
  ],
);

/** Person ↔ project (US-025, T-55). Never deleted; the state comes from the dates. */
export const workforceAssignment = sqliteTable(
  'workforce_assignment',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    workforceMemberId: text('workforce_member_id')
      .notNull()
      .references(() => workforceMember.id),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id),
    jobPositionId: text('job_position_id').references(() => workforceListItem.id),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    note: text('note'),
    endedBy: text('ended_by'),
    cancelledAt: timestamp('cancelled_at'),
    cancelledBy: text('cancelled_by'),
    ...auditColumns(),
  },
  (table) => [
    index('workforce_assignment_project_idx').on(table.projectId, table.startDate),
    index('workforce_assignment_member_idx').on(table.workforceMemberId, table.projectId),
    index('workforce_assignment_end_idx').on(table.companyId, table.endDate),
  ],
);

/**
 * Training, certificates, medical checks and personal documents (US-026 – US-028, US-030) in
 * one table with a `kind`, as places share one table (T-38). Never deleted: edited, voided or
 * replaced (T-48). `type` is the certificate or document type, or the medical result.
 */
export const workforceRecord = sqliteTable(
  'workforce_record',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    workforceMemberId: text('workforce_member_id')
      .notNull()
      .references(() => workforceMember.id),
    kind: text('kind', { enum: RECORD_KINDS }).notNull(),
    type: text('type'),
    name: text('name'),
    competencyId: text('competency_id').references(() => workforceListItem.id),
    number: text('number'),
    numberKey: text('number_key'),
    /** Training provider, issuing body or clinic. */
    issuer: text('issuer'),
    /** Passport issuing country. */
    country: text('country'),
    /** Completion, issue or assessment date. */
    issuedOn: text('issued_on'),
    expiresOn: text('expires_on'),
    noExpiry: integer('no_expiry', { mode: 'boolean' }).notNull().default(false),
    reference: text('reference'),
    restrictionNote: text('restriction_note'),
    note: text('note'),
    fileId: text('file_id'),
    replacesId: text('replaces_id').references((): AnySQLiteColumn => workforceRecord.id),
    replacedAt: timestamp('replaced_at'),
    voidedAt: timestamp('voided_at'),
    voidedBy: text('voided_by'),
    voidReason: text('void_reason'),
    ...auditColumns(),
  },
  (table) => [
    index('workforce_record_member_idx').on(table.workforceMemberId, table.kind, table.voidedAt),
    index('workforce_record_expiry_idx').on(table.companyId, table.expiresOn),
    index('workforce_record_number_idx').on(
      table.companyId,
      table.kind,
      table.type,
      table.country,
      table.numberKey,
    ),
    index('workforce_record_competency_idx').on(table.companyId, table.competencyId),
  ],
);

/** Up to 3 ordered contacts per person (US-029). Contact data, really deleted when removed. */
export const workforceEmergencyContact = sqliteTable(
  'workforce_emergency_contact',
  {
    ...primaryKey(),
    companyId: text('company_id').notNull(),
    workforceMemberId: text('workforce_member_id')
      .notNull()
      .references(() => workforceMember.id),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    relationship: text('relationship', { enum: CONTACT_RELATIONSHIPS }).notNull(),
    phone: text('phone').notNull(),
    phoneAlt: text('phone_alt'),
    ...auditColumns(),
  },
  (table) => [index('workforce_contact_member_idx').on(table.workforceMemberId, table.position)],
);

export type WorkforceListItemRow = typeof workforceListItem.$inferSelect;
export type WorkforceMemberRow = typeof workforceMember.$inferSelect;
export type WorkforceAssignmentRow = typeof workforceAssignment.$inferSelect;
export type WorkforceRecordRow = typeof workforceRecord.$inferSelect;
export type WorkforceContactRow = typeof workforceEmergencyContact.$inferSelect;
