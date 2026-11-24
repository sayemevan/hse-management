import {
  type emergencyContactsRequestSchema,
  type EmergencyContactsDto,
  generateId,
  WORKFORCE_LIMITS,
} from '@hse/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import { UnitOfWork } from '../../database/unit-of-work';
import { assertNotArchived } from './member.service';
import { assertRead, assertWrite, type WorkforceAccess } from './workforce-access';
import type { WorkforceContext } from './workforce-context';
import { ContactLimitError } from './workforce.errors';
import { workforceEmergencyContact, type WorkforceMemberRow } from './workforce.schema';

type ContactsInput = z.output<typeof emergencyContactsRequestSchema>;

/** US-029: up to 3 ordered contacts, replaced as one list. */
export class ContactService {
  constructor(private readonly ctx: WorkforceContext) {}

  async list(access: WorkforceAccess, member: WorkforceMemberRow): Promise<EmergencyContactsDto> {
    assertRead(access, member.id, 'contacts');
    const rows = await this.ctx.repo.contacts(member.id);
    return {
      items: rows.map((row) => ({
        name: row.name,
        relationship: row.relationship,
        phone: row.phone,
        phoneAlt: row.phoneAlt,
        position: row.position,
      })),
    };
  }

  async replace(
    access: WorkforceAccess,
    principal: Principal,
    member: WorkforceMemberRow,
    input: ContactsInput,
  ): Promise<EmergencyContactsDto> {
    assertWrite(access, member.id, 'contacts');
    assertNotArchived(member);
    if (input.items.length > WORKFORCE_LIMITS.contactsMax) {
      throw new ContactLimitError(WORKFORCE_LIMITS.contactsMax);
    }
    const before = await this.ctx.repo.contacts(member.id);
    const now = new Date(this.ctx.now());
    const work = new UnitOfWork(this.ctx.db).add(
      this.ctx.db
        .delete(workforceEmergencyContact)
        .where(eq(workforceEmergencyContact.workforceMemberId, member.id)),
    );
    input.items.forEach((item, index) => {
      work.add(
        this.ctx.db.insert(workforceEmergencyContact).values({
          id: generateId(),
          companyId: member.companyId,
          workforceMemberId: member.id,
          position: index + 1,
          name: item.name,
          relationship: item.relationship,
          phone: item.phone,
          phoneAlt: item.phoneAlt ?? null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
      );
    });
    work.add(
      // The audit keeps the lists; the History entry has no contact details (US-029).
      ...this.ctx.record(principal, member, {
        audit: 'workforce.contacts.updated',
        activity: 'workforce.contacts.updated',
        oldValue: {
          items: before.map((row) => ({
            name: row.name,
            relationship: row.relationship,
            phone: row.phone,
            phoneAlt: row.phoneAlt,
          })),
        },
        newValue: { items: input.items },
        snapshot: { count: input.items.length },
      }),
    );
    await work.commit();
    return this.list(access, member);
  }
}
