import type { WorkforceCanDto } from '@hse/shared';

import { ForbiddenError, NotFoundError } from '../../core/errors/app-error';
import type { Database } from '../../database/client';
import { type PermissionResolver, WorkforceUserLinks } from '../identity';
import type { WorkforceMemberRow } from './workforce.schema';

/**
 * What the caller may do in the workforce area (O-73 – O-77, O-85). Company-scope permissions
 * come from the company role; a linked user also reads their own record (O-85).
 */
export interface WorkforceAccess {
  userId: string;
  view: boolean;
  manage: boolean;
  contacts: boolean;
  personal: boolean;
  lists: boolean;
  users: boolean;
  ownMemberId: string | null;
}

export async function loadWorkforceAccess(
  db: Database,
  resolver: PermissionResolver,
  userId: string,
  companyId: string,
): Promise<WorkforceAccess> {
  const [granted, ownMemberId] = await Promise.all([
    resolver.companyPermissions(userId, companyId),
    new WorkforceUserLinks(db).memberOf(userId, companyId),
  ]);
  return {
    userId,
    view: granted.has('workforce.view'),
    manage: granted.has('workforce.manage'),
    contacts: granted.has('workforce.contacts.view'),
    personal: granted.has('workforce.personal.view'),
    lists: granted.has('workforce.lists.manage'),
    users: granted.has('users.view'),
    ownMemberId,
  };
}

export type MemberRight = 'view' | 'contacts' | 'personal';

/** The caller reads this profile's part: by permission, or because it is their own (O-85). */
export function mayRead(access: WorkforceAccess, memberId: string, right: MemberRight): boolean {
  return access[right] || access.ownMemberId === memberId;
}

/** Read guard for one profile. Without even `view`, the profile doesn't exist for the caller. */
export function assertRead(access: WorkforceAccess, memberId: string, right: MemberRight): void {
  if (!mayRead(access, memberId, 'view')) throw new NotFoundError();
  if (!mayRead(access, memberId, right)) throw new ForbiddenError();
}

/** Write guard: `workforce.manage`, plus the read right of the part changed (O-74). */
export function assertWrite(access: WorkforceAccess, memberId: string, right: MemberRight): void {
  if (!mayRead(access, memberId, 'view')) throw new NotFoundError();
  if (!access.manage || !access[right]) throw new ForbiddenError();
}

export function canOf(access: WorkforceAccess, row: WorkforceMemberRow): WorkforceCanDto {
  const editable = access.manage && row.archivedAt === null;
  return {
    manage: access.manage,
    edit: editable,
    viewContacts: mayRead(access, row.id, 'contacts'),
    editContacts: editable && access.contacts,
    viewPersonal: mayRead(access, row.id, 'personal'),
    editPersonal: editable && access.personal,
    linkUser: access.manage && access.users,
    own: access.ownMemberId === row.id,
  };
}
