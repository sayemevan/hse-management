/**
 * Identity module — public contract.
 *
 * Purpose: who the user is and whether they may be signed in right now.
 * Responsibilities: users, role assignments, sessions, sign-in, token refresh, sign-out,
 * password change (US-001, US-004, US-005, US-010; PLT-04 bootstrap).
 * Dependencies: company (tenant context), platform/audit-log, core/auth.
 * Sprint 3: invitations (US-006), forgot/reset password (US-002, US-003), profile (US-007),
 * temporary company permissions (PLT-08).
 * Sprint 5: the permission matrix and its checker (PLT-16), role assignment (US-008) and
 * company permission changes (US-009).
 */
export {
  AccountProvisioning,
  type NewCompanyAdministrator,
  type Recipient,
} from './account-provisioning.service';
export {
  type CompanyPermission,
  loadCompanyPermissions,
  requireCompanyPermission,
} from './company-permission';
export {
  matrixPermissionChecker,
  type ProjectAccess,
  PermissionResolver,
  permissionResolverFor,
} from './permission-matrix';
export { currentAccount, validateIdentitySession } from './identity.factory';
export { invitationRoutes, userRoutes } from './users.routes';
export { UserCounter } from './user-counter';
export { userNames, type UserSummary, userSummaries } from './user-names';
export { type MemberRow, ProjectMembership } from './project-membership';
export { requirePlatformPermission } from './platform-permission';
export {
  type AssignmentOptions,
  BulkAddRefusedError,
  type ProjectRef,
  type ProjectRoleView,
  RoleAssignmentService,
  type UserRolesView,
} from './role-assignment.service';
export { ProjectAudience } from './project-audience';
export { WorkforceUserLinks } from './workforce-link';
export { UserPreferences } from './user-preferences';
export { RolePermissionService } from './role-permission.service';
export { purgeEndedSessionTokens } from './session-maintenance';
export { authRoutes } from './identity.routes';
export {
  ROLE_CODES,
  type RoleCode,
  user,
  USER_STATUSES,
  userRole,
  userSession,
  type UserStatus,
} from './identity.schema';
