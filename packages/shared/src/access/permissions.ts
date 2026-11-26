import { INVITABLE_ROLES, type InvitableRole } from '../users/user-contracts';

/**
 * Permission catalogue and default matrix (PLT-16, T-30; approved in D-44 / O-43).
 *
 * One entry per action (Doc 07 §5), grouped by module (Doc 07 §9). The API seeds this list
 * into the `permission` and `role_permission` tables, and a unit test checks that the two
 * stay identical. Later sprints add their permissions here, with defaults approved in their
 * own specs.
 */

/** The 13 company roles (D-02 without System Owner). A user's company role is one of these. */
export const COMPANY_ROLES = INVITABLE_ROLES;
export type CompanyRole = InvitableRole;

/** O-45: these roles act in every project of the company without being assigned to it. */
export const COMPANY_WIDE_ROLES = ['company_administrator', 'hse_director', 'hse_manager'] as const;

/** Roles a user can hold on a project (PLT-16 "Roles allowed at each scope", O-47). */
export const PROJECT_ROLES = [
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
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** O-48: temporary access for outside parties must end on a date. */
export const PROJECT_ROLES_REQUIRING_END_DATE: readonly ProjectRole[] = [
  'client',
  'consultant',
  'auditor',
];

export type PermissionScopeLevel = 'platform' | 'company' | 'project';

export type PermissionModule =
  'platform' | 'company' | 'users' | 'roles' | 'subscription' | 'projects' | 'workforce';

export interface PermissionDefinition {
  readonly code: string;
  readonly module: PermissionModule;
  readonly scope: PermissionScopeLevel;
  /** Granted by default (O-43). Platform permissions list `system_owner`. */
  readonly defaults: readonly string[];
  /** Always granted to these roles, whatever the company sets (O-54). */
  readonly lockedFor?: readonly CompanyRole[];
}

const ALL_COMPANY_ROLES: readonly CompanyRole[] = COMPANY_ROLES;
const CA = 'company_administrator';
const HD = 'hse_director';
const HM = 'hse_manager';
const PM = 'project_manager';
const SO = 'safety_officer';
const SE = 'site_engineer';
const SV = 'supervisor';
const FM = 'foreman';
const IN = 'inspector';
const AU = 'auditor';
const CL = 'client';
const CO = 'consultant';

export const PERMISSIONS = [
  // Company scope
  {
    code: 'company.view',
    module: 'company',
    scope: 'company',
    defaults: ALL_COMPANY_ROLES,
    lockedFor: [CA],
  },
  { code: 'company.edit', module: 'company', scope: 'company', defaults: [CA] },
  { code: 'company.settings.edit', module: 'company', scope: 'company', defaults: [CA] },
  { code: 'company.logo.edit', module: 'company', scope: 'company', defaults: [CA] },
  {
    code: 'users.view',
    module: 'users',
    scope: 'company',
    defaults: [CA, HD, HM],
    lockedFor: [CA],
  },
  { code: 'users.invite', module: 'users', scope: 'company', defaults: [CA] },
  {
    code: 'users.roles.assign',
    module: 'users',
    scope: 'company',
    defaults: [CA],
    lockedFor: [CA],
  },
  { code: 'roles.view', module: 'roles', scope: 'company', defaults: [CA, HD], lockedFor: [CA] },
  {
    code: 'roles.permissions.edit',
    module: 'roles',
    scope: 'company',
    defaults: [CA],
    lockedFor: [CA],
  },
  { code: 'subscription.view', module: 'subscription', scope: 'company', defaults: [CA] },
  { code: 'subscription.pay', module: 'subscription', scope: 'company', defaults: [CA] },
  { code: 'projects.create', module: 'projects', scope: 'company', defaults: [CA, HD] },
  // Project scope
  { code: 'projects.view', module: 'projects', scope: 'project', defaults: ALL_COMPANY_ROLES },
  { code: 'projects.edit', module: 'projects', scope: 'project', defaults: [CA, HD, PM] },
  { code: 'projects.status.change', module: 'projects', scope: 'project', defaults: [CA, HD, PM] },
  { code: 'projects.archive', module: 'projects', scope: 'project', defaults: [CA] },
  // Sprint 6 (D-47: O-59, O-65 – O-67)
  {
    code: 'projects.structure.manage',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO],
  },
  {
    code: 'projects.members.view',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO, SE, SV, AU],
  },
  { code: 'projects.members.manage', module: 'projects', scope: 'project', defaults: [CA, HD, PM] },
  {
    code: 'projects.timeline.view',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO, SE, AU],
  },
  // Sprint 7 (D-50: O-73 – O-77)
  {
    code: 'projects.workforce.view',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO, SE, SV, FM, IN, AU],
  },
  {
    code: 'projects.workforce.manage',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO],
  },
  {
    code: 'workforce.view',
    module: 'workforce',
    scope: 'company',
    defaults: [CA, HD, HM, PM, SO, SE, SV],
  },
  { code: 'workforce.manage', module: 'workforce', scope: 'company', defaults: [CA, HD, HM, SO] },
  {
    code: 'workforce.contacts.view',
    module: 'workforce',
    scope: 'company',
    defaults: [CA, HD, HM, PM, SO, SV],
  },
  {
    code: 'workforce.personal.view',
    module: 'workforce',
    scope: 'company',
    defaults: [CA, HD, HM],
  },
  { code: 'workforce.lists.manage', module: 'workforce', scope: 'company', defaults: [CA, HD, HM] },
  // Sprint 8 (D-53: O-107). Participants see their own actions without `projects.actions.view`.
  {
    code: 'projects.actions.view',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO, SE, SV, FM, IN, CL, CO, AU],
  },
  {
    code: 'projects.actions.create',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO, SE, SV, FM, IN],
  },
  {
    code: 'projects.actions.manage',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO],
  },
  // PM added during the build (D-54): T-46 would otherwise stop PMs adding Safety Officers.
  {
    code: 'projects.actions.verify',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO],
  },
  {
    code: 'projects.actions.close',
    module: 'projects',
    scope: 'project',
    defaults: [CA, HD, HM, PM, SO],
  },
  // Platform scope (not editable by companies)
  {
    code: 'platform.registrations.view',
    module: 'platform',
    scope: 'platform',
    defaults: ['system_owner'],
  },
  {
    code: 'platform.registrations.approve',
    module: 'platform',
    scope: 'platform',
    defaults: ['system_owner'],
  },
  {
    code: 'platform.registrations.reject',
    module: 'platform',
    scope: 'platform',
    defaults: ['system_owner'],
  },
  {
    code: 'platform.payments.review',
    module: 'platform',
    scope: 'platform',
    defaults: ['system_owner'],
  },
  {
    code: 'platform.subscriptions.view',
    module: 'platform',
    scope: 'platform',
    defaults: ['system_owner'],
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];
export type CompanyPermissionCode = Extract<
  (typeof PERMISSIONS)[number],
  { scope: 'company' }
>['code'];
export type ProjectPermissionCode = Extract<
  (typeof PERMISSIONS)[number],
  { scope: 'project' }
>['code'];
export type PlatformPermissionCode = Extract<
  (typeof PERMISSIONS)[number],
  { scope: 'platform' }
>['code'];

const BY_CODE = new Map<string, PermissionDefinition>(
  PERMISSIONS.map((entry) => [entry.code, entry]),
);

export function permissionDefinition(code: string): PermissionDefinition | undefined {
  return BY_CODE.get(code);
}

/** Companies may change company and project permissions, never platform ones. */
export function isCompanyEditable(definition: PermissionDefinition): boolean {
  return definition.scope !== 'platform';
}

export function isLocked(code: string, role: string): boolean {
  return Boolean(permissionDefinition(code)?.lockedFor?.includes(role as CompanyRole));
}

export function isCompanyWideRole(role: string): boolean {
  return (COMPANY_WIDE_ROLES as readonly string[]).includes(role);
}

export function isProjectRole(role: string): role is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(role);
}

/**
 * A role's permissions in a company: the defaults, then the company's differences
 * (`granted` true or false), then the locked ones forced on (PLT-16 FR-3).
 */
export function effectiveRolePermissions(
  role: string,
  defaults: Iterable<string>,
  overrides: Iterable<{ permissionCode: string; granted: boolean }>,
): Set<string> {
  const result = new Set(defaults);
  for (const override of overrides) {
    const definition = permissionDefinition(override.permissionCode);
    if (!definition || !isCompanyEditable(definition)) continue;
    if (override.granted) result.add(override.permissionCode);
    else result.delete(override.permissionCode);
  }
  for (const entry of PERMISSIONS) {
    if (isLocked(entry.code, role)) result.add(entry.code);
  }
  return result;
}

/** The default permissions of a role, straight from the catalogue. */
export function defaultPermissionsOf(role: string): string[] {
  return PERMISSIONS.filter((entry) => (entry.defaults as readonly string[]).includes(role)).map(
    (entry) => entry.code,
  );
}
