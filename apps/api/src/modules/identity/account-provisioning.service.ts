import { generateId, type Language } from '@hse/shared';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { user, userRole } from './identity.schema';

export interface NewCompanyAdministrator {
  userId: string;
  companyId: string;
  email: string;
  fullName: string;
  /** Already hashed with the platform hasher (O-12). */
  passwordHash: string;
  language: Language;
  timeZone: string;
  createdBy: string;
}

export interface Recipient {
  id: string;
  email: string;
  fullName: string;
  language: Language;
}

/**
 * What other modules may ask of the identity module about accounts (US-011.1, US-011.3).
 * Returns statements so callers commit them atomically with their own changes.
 */
export class AccountProvisioning {
  constructor(private readonly db: Database) {}

  /** D-08: an email belongs to at most one account, archived accounts included. */
  async isEmailInUse(email: string): Promise<boolean> {
    const row = await this.db.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
    return row !== undefined;
  }

  /** The first Company Administrator, created when a registration is approved. */
  createCompanyAdministrator(input: NewCompanyAdministrator): Statement[] {
    return [
      this.db.insert(user).values({
        id: input.userId,
        companyId: input.companyId,
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        status: 'active',
        preferredLanguage: input.language,
        timeZone: input.timeZone,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      }),
      this.db.insert(userRole).values({
        id: generateId(),
        userId: input.userId,
        roleCode: 'company_administrator',
        scopeLevel: 'company',
        companyId: input.companyId,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      }),
    ];
  }

  /** Active System Owners, e.g. to notify them of a new registration (O-18). */
  async listActiveSystemOwners(): Promise<Recipient[]> {
    const rows = await this.db
      .selectDistinct({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        language: user.preferredLanguage,
      })
      .from(user)
      .innerJoin(userRole, eq(userRole.userId, user.id))
      .where(
        and(
          eq(userRole.roleCode, 'system_owner'),
          eq(userRole.scopeLevel, 'platform'),
          eq(user.status, 'active'),
          isNull(user.deletedAt),
        ),
      )
      .all();
    return rows.map((row) => ({ ...row, language: row.language ?? 'en' }));
  }

  /**
   * Active Company Administrators of a company (PLT-15 FR-1), each with their own language or
   * the company default.
   */
  async listActiveCompanyAdministrators(
    companyId: string,
    fallbackLanguage: Language,
  ): Promise<Recipient[]> {
    const rows = await this.db
      .selectDistinct({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        language: user.preferredLanguage,
      })
      .from(user)
      .innerJoin(userRole, eq(userRole.userId, user.id))
      .where(
        and(
          eq(user.companyId, companyId),
          eq(userRole.companyId, companyId),
          eq(userRole.roleCode, 'company_administrator'),
          eq(userRole.scopeLevel, 'company'),
          or(isNull(userRole.validUntil), gt(userRole.validUntil, new Date())),
          eq(user.status, 'active'),
          isNull(user.deletedAt),
        ),
      )
      .all();
    return rows.map((row) => ({ ...row, language: row.language ?? fallbackLanguage }));
  }

  /** Display names for user ids (e.g. "decided by" in review history). */
  async namesById(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: user.id, fullName: user.fullName })
      .from(user)
      .where(inArray(user.id, ids))
      .all();
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }
}
