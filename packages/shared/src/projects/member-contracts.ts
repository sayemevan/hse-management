import { z } from 'zod';

import type { ProjectRoleState } from '../access/access-contracts';
import { PROJECT_ROLES } from '../access/permissions';
import { isoDateSchema, type ProjectStatus } from './project-contracts';

/** O-69: up to 50 people at once, all or none. */
export const MEMBER_BULK_MAX = 50;

export const addMembersRequestSchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(MEMBER_BULK_MAX),
  roleCode: z.enum(PROJECT_ROLES),
  validFrom: isoDateSchema.nullable().optional(),
  validUntil: isoDateSchema.nullable().optional(),
});
export type AddMembersRequest = z.input<typeof addMembersRequestSchema>;

export const updateMemberRequestSchema = z.object({
  roleCode: z.enum(PROJECT_ROLES).optional(),
  validUntil: isoDateSchema.nullable().optional(),
});
export type UpdateMemberRequest = z.input<typeof updateMemberRequestSchema>;

export const memberListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  role: z.enum(PROJECT_ROLES).optional(),
  include: z.enum(['past']).optional(),
});

export const memberCandidatesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});

// ---- Responses -------------------------------------------------------------------------

export interface MemberUserDto {
  id: string;
  fullName: string;
  /** Only for callers holding `users.view` (US-022 FR-1). */
  email: string | null;
  phone: string | null;
  status: string;
}

export interface ProjectMemberDto {
  assignmentId: string;
  user: MemberUserDto;
  roleCode: string;
  validFrom: string | null;
  validUntil: string | null;
  state: ProjectRoleState;
  /** The caller may change or remove this member (T-46, O-67). */
  manageable: boolean;
}

export interface CompanyWideMemberDto {
  user: MemberUserDto;
  companyRoleCode: string;
}

export interface ProjectMembersDto {
  team: ProjectMemberDto[];
  past: ProjectMemberDto[];
  companyWide: CompanyWideMemberDto[];
}

export interface MemberCandidateDto {
  id: string;
  fullName: string;
  email: string;
  status: string;
  onProject: boolean;
  companyWide: boolean;
}

export interface MemberCandidatesDto {
  items: MemberCandidateDto[];
  /** Project roles the caller may give on this project ("no more than you hold"). */
  assignableRoles: string[];
}

export interface BulkAddRefusal {
  userId: string;
  name: string;
  reason: 'alreadyOnProject' | 'companyWide' | 'notInCompany';
}

// ---- Project context (PLT-19) ----------------------------------------------------------

export const switcherQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
});

export const lastProjectRequestSchema = z.object({ projectId: z.uuid() });

export interface SwitcherProjectDto {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
}

export interface ProjectSwitcherDto {
  items: SwitcherProjectDto[];
  lastProjectId: string | null;
}

export interface ProjectCountsDto {
  areas: number;
  locations: number;
  workZones: number;
  members: number;
}
