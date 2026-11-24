import type { Language } from '@hse/shared';
import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { company, type CompanyRow } from './company.schema';

export interface NewCompany {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  city: string;
  timeZone: string;
  defaultLanguage: Language;
  contactEmail: string;
  contactPhone: string;
  createdBy: string;
}

export interface CompanyProfileUpdate {
  name?: string;
  registrationNumber?: string | null;
  countryCode?: string;
  city?: string;
  address?: string | null;
  timeZone?: string;
  defaultLanguage?: Language;
  contactEmail?: string;
  contactPhone?: string;
}

/** The only code that reads or writes the `company` table. */
export class CompanyRepository {
  constructor(private readonly db: Database) {}

  async findBySlug(slug: string): Promise<CompanyRow | undefined> {
    return this.db.select().from(company).where(eq(company.slug, slug)).get();
  }

  async findById(id: string): Promise<CompanyRow | undefined> {
    return this.db.select().from(company).where(eq(company.id, id)).get();
  }

  /** Profile fields an administrator may change (US-012). Never slug or status (O-29). */
  update(id: string, fields: CompanyProfileUpdate, actorId: string, now: number): Statement {
    return this.db
      .update(company)
      .set({ ...fields, updatedAt: new Date(now), updatedBy: actorId })
      .where(eq(company.id, id));
  }

  /** Points the company at a new logo file, or none (US-014). */
  setLogo(id: string, fileId: string | null, actorId: string, now: number): Statement {
    return this.db
      .update(company)
      .set({ logoFileId: fileId, updatedAt: new Date(now), updatedBy: actorId })
      .where(eq(company.id, id));
  }

  /**
   * Keeps the company status in step with its subscription (T-23): `read_only` or `active`.
   * Never touches a suspended or not-yet-approved company (PLT-10 FR-5).
   */
  setAccessStatus(
    id: string,
    status: 'active' | 'read_only',
    actorId: string | null,
    now: number,
  ): Statement {
    return this.db
      .update(company)
      .set({ status, updatedAt: new Date(now), updatedBy: actorId })
      .where(and(eq(company.id, id), inArray(company.status, ['active', 'read_only'])));
  }

  async findManyByIds(ids: readonly string[]): Promise<CompanyRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(company)
      .where(inArray(company.id, [...ids]))
      .all();
  }

  create(input: NewCompany): Statement {
    return this.db.insert(company).values({
      ...input,
      status: 'active',
      updatedBy: input.createdBy,
    });
  }
}
