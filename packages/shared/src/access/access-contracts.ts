import { z } from 'zod';

import { isoDateSchema } from '../projects/project-contracts';
import { COMPANY_ROLES, PROJECT_ROLES } from './permissions';

// ---- US-008 role assignment ------------------------------------------------------------

export const changeCompanyRoleRequestSchema = z.object({
  roleCode: z.enum(COMPANY_ROLES),
});
export type ChangeCompanyRoleRequest = z.input<typeof changeCompanyRoleRequestSchema>;

export const addProjectRoleRequestSchema = z.object({
  projectId: z.uuid(),
  roleCode: z.enum(PROJECT_ROLES),
  validFrom: isoDateSchema.nullable().optional(),
  validUntil: isoDateSchema.nullable().optional(),
});
export type AddProjectRoleRequest = z.input<typeof addProjectRoleRequestSchema>;

export const updateProjectRoleRequestSchema = z.object({
  roleCode: z.enum(PROJECT_ROLES).optional(),
  validUntil: isoDateSchema.nullable().optional(),
});
export type UpdateProjectRoleRequest = z.input<typeof updateProjectRoleRequestSchema>;

export type ProjectRoleState = 'active' | 'scheduled' | 'ended';

export interface ProjectRoleAssignmentDto {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  projectStatus: string;
  roleCode: string;
  /** Calendar dates (`YYYY-MM-DD`) in the company's time zone; null = no limit. */
  validFrom: string | null;
  validUntil: string | null;
  state: ProjectRoleState;
}

export interface UserDetailDto {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  lastLoginAt: number | null;
  companyRole: string | null;
  projectRoles: ProjectRoleAssignmentDto[];
  pastProjectRoles: ProjectRoleAssignmentDto[];
}

// ---- US-009 permission assignment ------------------------------------------------------

export const updateRolePermissionsRequestSchema = z.object({
  version: z.number().int().min(0),
  granted: z.array(z.string().min(1).max(100)).max(200),
});
export type UpdateRolePermissionsRequest = z.input<typeof updateRolePermissionsRequestSchema>;

export const resetRolePermissionsRequestSchema = z.object({
  version: z.number().int().min(0),
});

export interface RoleSummaryDto {
  code: string;
  userCount: number;
  customised: boolean;
  companyWide: boolean;
}

export interface RolePermissionDto {
  code: string;
  module: string;
  scope: 'company' | 'project';
  granted: boolean;
  default: boolean;
  locked: boolean;
}

export interface RoleDetailDto {
  code: string;
  companyWide: boolean;
  userCount: number;
  customised: boolean;
  /** Epoch ms of the last change, 0 if never changed; sent back on save (FR-8). */
  version: number;
  permissions: RolePermissionDto[];
}
