import { LANGUAGES } from '@hse/shared';
import {
  index,
  integer,
  primaryKey as compositeKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { auditColumns, primaryKey, softDeleteColumns } from '../../database/columns';
import { company } from '../company';

/** Account statuses (Product Book Doc 07 §13). "locked" is an administrator lock (O-2). */
export const USER_STATUSES = [
  'pending_invitation',
  'active',
  'suspended',
  'locked',
  'archived',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Role catalogue (D-02). Permissions per role: the matrix below (PLT-16). */
export const ROLE_CODES = [
  'system_owner',
  'company_administrator',
  'hse_director',
  'hse_manager',
  'project_manager',
  'safety_officer',
  'site_engineer',
  'supervisor',
  'foreman',
  'inspector',
  'worker',
  'client',
  'consultant',
  'auditor',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const SCOPE_LEVELS = ['platform', 'company', 'project'] as const;

export const SESSION_REVOKE_REASONS = [
  'logout',
  'user_revoked',
  'password_changed',
  'password_reset',
  'token_reuse',
  'admin',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** `user` (US-001). `company_id` is null only for platform users (System Owner). */
export const user = sqliteTable(
  'user',
  {
    ...primaryKey(),
    companyId: text('company_id').references(() => company.id),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    // Sprint 3 (US-007). E.164.
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    status: text('status', { enum: USER_STATUSES }).notNull(),
    preferredLanguage: text('preferred_language', { enum: LANGUAGES }),
    timeZone: text('time_zone'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until'),
    lastLoginAt: timestamp('last_login_at'),
    passwordChangedAt: timestamp('password_changed_at'),
    // Optional link to a workforce profile (D-09). Unique; no database foreign key (T-53).
    workforceMemberId: text('workforce_member_id'),
    ...auditColumns(),
    ...softDeleteColumns(),
  },
  (table) => [
    uniqueIndex('user_email_unique').on(table.email),
    index('user_company_idx').on(table.companyId),
    uniqueIndex('user_workforce_member_unique').on(table.workforceMemberId),
  ],
);

/** Role held by a user within a scope (PLT-04). */
export const userRole = sqliteTable(
  'user_role',
  {
    ...primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    roleCode: text('role_code', { enum: ROLE_CODES }).notNull(),
    scopeLevel: text('scope_level', { enum: SCOPE_LEVELS }).notNull(),
    companyId: text('company_id').references(() => company.id),
    // Sprint 5 (US-008). No database foreign key: `project` belongs to the project module,
    // which depends on identity; the role service checks the project exists (as for
    // `company.logo_file_id`, Sprint 3).
    projectId: text('project_id'),
    validFrom: timestamp('valid_from'),
    validUntil: timestamp('valid_until'),
    ...auditColumns(),
  },
  (table) => [
    index('user_role_user_idx').on(table.userId),
    index('user_role_project_idx').on(table.projectId),
  ],
);

/** One row per signed-in device (US-001, US-010). Rows are kept after expiry for history. */
export const userSession = sqliteTable(
  'user_session',
  {
    ...primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    refreshTokenHash: text('refresh_token_hash'),
    previousRefreshTokenHash: text('previous_refresh_token_hash'),
    refreshRotatedAt: timestamp('refresh_rotated_at'),
    deviceLabel: text('device_label').notNull(),
    browser: text('browser').notNull(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').notNull(),
    lastActivityAt: timestamp('last_activity_at').notNull(),
    idleExpiresAt: timestamp('idle_expires_at').notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    revokedReason: text('revoked_reason', { enum: SESSION_REVOKE_REASONS }),
  },
  (table) => [
    index('user_session_user_idx').on(table.userId),
    uniqueIndex('user_session_refresh_unique').on(table.refreshTokenHash),
    index('user_session_previous_refresh_idx').on(table.previousRefreshTokenHash),
  ],
);

/**
 * Invitation history (US-006, T-15). The invited person already has a `user` row with status
 * `pending_invitation`; this table records who invited them and what happened to the invitation.
 */
export const userInvitation = sqliteTable(
  'user_invitation',
  {
    ...primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => user.id),
    roleCode: text('role_code', { enum: ROLE_CODES }).notNull(),
    language: text('language', { enum: LANGUAGES }).notNull(),
    sentAt: timestamp('sent_at').notNull(),
    lastSentAt: timestamp('last_sent_at').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    resendCount: integer('resend_count').notNull().default(0),
    acceptedAt: timestamp('accepted_at'),
    revokedAt: timestamp('revoked_at'),
    revokedBy: text('revoked_by'),
    ...auditColumns(),
  },
  (table) => [
    index('user_invitation_user_idx').on(table.userId),
    index('user_invitation_company_idx').on(table.companyId),
  ],
);

/** Permission catalogue (PLT-16, T-30), seeded from `PERMISSIONS` in the shared package. */
export const permission = sqliteTable('permission', {
  code: text('code').primaryKey(),
  module: text('module').notNull(),
  scopeLevel: text('scope_level', { enum: SCOPE_LEVELS }).notNull(),
  companyEditable: integer('company_editable', { mode: 'boolean' }).notNull(),
  sortOrder: integer('sort_order').notNull(),
});

/** Default matrix: which role holds which permission (PLT-16, O-43). Seeded. */
export const rolePermission = sqliteTable(
  'role_permission',
  {
    roleCode: text('role_code', { enum: ROLE_CODES }).notNull(),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permission.code),
  },
  (table) => [compositeKey({ columns: [table.roleCode, table.permissionCode] })],
);

/** A company's differences from the default matrix (US-009). Only differences are stored. */
export const companyRolePermission = sqliteTable(
  'company_role_permission',
  {
    ...primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    roleCode: text('role_code', { enum: ROLE_CODES }).notNull(),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permission.code),
    granted: integer('granted', { mode: 'boolean' }).notNull(),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex('company_role_permission_unique').on(
      table.companyId,
      table.roleCode,
      table.permissionCode,
    ),
  ],
);

/**
 * Per-user values that aren't profile fields (PLT-19). `last_project_id` has no foreign key:
 * identity never references the project table (T-34, T-35).
 */
export const userPreference = sqliteTable('user_preference', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id),
  lastProjectId: text('last_project_id'),
  updatedAt: timestamp('updated_at').notNull(),
});

export type UserRow = typeof user.$inferSelect;
export type UserInvitationRow = typeof userInvitation.$inferSelect;
export type UserSessionRow = typeof userSession.$inferSelect;
export type UserRoleRow = typeof userRole.$inferSelect;
export type CompanyRolePermissionRow = typeof companyRolePermission.$inferSelect;
