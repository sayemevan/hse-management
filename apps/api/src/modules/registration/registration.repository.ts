import type { Language, RegistrationStatus } from '@hse/shared';
import { and, asc, count, desc, eq, inArray, lt, notInArray } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import {
  companyRegistration,
  type CompanyRegistrationRow,
  registrationReview,
  type RegistrationReviewRow,
} from './registration.schema';

const CLOSED_STATUSES: RegistrationStatus[] = ['approved', 'closed'];

export interface NewRegistration {
  id: string;
  companyName: string;
  slug: string;
  countryCode: string;
  city: string;
  timeZone: string;
  defaultLanguage: Language;
  applicantName: string;
  applicantEmail: string;
  applicantPhone: string;
  applicantLanguage: Language;
  passwordHash: string;
  planCode: string;
  ipAddress: string | null;
  now: number;
}

export type EditableRegistrationFields = Pick<
  NewRegistration,
  | 'companyName'
  | 'slug'
  | 'countryCode'
  | 'city'
  | 'timeZone'
  | 'defaultLanguage'
  | 'applicantName'
  | 'applicantPhone'
  | 'applicantLanguage'
  | 'planCode'
>;

export interface NewReview {
  id: string;
  registrationId: string;
  decision: 'approved' | 'rejected';
  reason: string | null;
  phoneConfirmed: boolean;
  previousPlanCode: string | null;
  newPlanCode: string | null;
  decidedBy: string;
  now: number;
}

/** The only code that reads or writes `company_registration` and `registration_review`. */
export class RegistrationRepository {
  constructor(private readonly db: Database) {}

  create(input: NewRegistration): Statement {
    const { now, ...fields } = input;
    return this.db.insert(companyRegistration).values({
      ...fields,
      status: 'pending_email_verification',
      termsAcceptedAt: new Date(now),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
  }

  async findById(id: string): Promise<CompanyRegistrationRow | undefined> {
    return this.db.select().from(companyRegistration).where(eq(companyRegistration.id, id)).get();
  }

  /** Open = not approved and not closed; open applications reserve slug and email (O-16, D-08). */
  async findOpenBySlug(slug: string): Promise<CompanyRegistrationRow | undefined> {
    return this.db
      .select()
      .from(companyRegistration)
      .where(
        and(
          eq(companyRegistration.slug, slug),
          notInArray(companyRegistration.status, CLOSED_STATUSES),
        ),
      )
      .get();
  }

  async findOpenByEmail(email: string): Promise<CompanyRegistrationRow | undefined> {
    return this.db
      .select()
      .from(companyRegistration)
      .where(
        and(
          eq(companyRegistration.applicantEmail, email),
          notInArray(companyRegistration.status, CLOSED_STATUSES),
        ),
      )
      .get();
  }

  async list(
    status: RegistrationStatus | undefined,
    offset: number,
    limit: number,
  ): Promise<{ rows: CompanyRegistrationRow[]; total: number }> {
    const where = status ? eq(companyRegistration.status, status) : undefined;
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(companyRegistration)
        .where(where)
        // Oldest submissions first, so the queue is worked in order (US-011.3).
        .orderBy(asc(companyRegistration.submittedAt), asc(companyRegistration.createdAt))
        .limit(limit)
        .offset(offset)
        .all(),
      this.db.select({ value: count() }).from(companyRegistration).where(where).get(),
    ]);
    return { rows, total: totals?.value ?? 0 };
  }

  markSubmitted(id: string, now: number, fromStatus: RegistrationStatus): Statement {
    return this.db
      .update(companyRegistration)
      .set({
        status: 'submitted',
        emailVerifiedAt: new Date(now),
        submittedAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(and(eq(companyRegistration.id, id), eq(companyRegistration.status, fromStatus)));
  }

  markApproved(
    id: string,
    companyId: string,
    planCode: string,
    now: number,
    actor: string,
  ): Statement {
    return this.db
      .update(companyRegistration)
      .set({
        status: 'approved',
        companyId,
        planCode,
        decidedAt: new Date(now),
        updatedAt: new Date(now),
        updatedBy: actor,
      })
      .where(and(eq(companyRegistration.id, id), eq(companyRegistration.status, 'submitted')));
  }

  markRejected(id: string, now: number, actor: string): Statement {
    return this.db
      .update(companyRegistration)
      .set({
        status: 'rejected',
        decidedAt: new Date(now),
        updatedAt: new Date(now),
        updatedBy: actor,
      })
      .where(and(eq(companyRegistration.id, id), eq(companyRegistration.status, 'submitted')));
  }

  resubmit(
    id: string,
    fields: EditableRegistrationFields,
    passwordHash: string | null,
    now: number,
  ): Statement {
    return this.db
      .update(companyRegistration)
      .set({
        ...fields,
        ...(passwordHash ? { passwordHash } : {}),
        status: 'submitted',
        submittedAt: new Date(now),
        decidedAt: null,
        updatedAt: new Date(now),
      })
      .where(and(eq(companyRegistration.id, id), eq(companyRegistration.status, 'rejected')));
  }

  addReview(input: NewReview): Statement {
    const { now, ...fields } = input;
    return this.db.insert(registrationReview).values({ ...fields, decidedAt: new Date(now) });
  }

  async reviews(registrationId: string): Promise<RegistrationReviewRow[]> {
    return this.db
      .select()
      .from(registrationReview)
      .where(eq(registrationReview.registrationId, registrationId))
      .orderBy(desc(registrationReview.decidedAt))
      .all();
  }

  async unverifiedCreatedBefore(cutoff: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: companyRegistration.id })
      .from(companyRegistration)
      .where(
        and(
          eq(companyRegistration.status, 'pending_email_verification'),
          lt(companyRegistration.createdAt, new Date(cutoff)),
        ),
      )
      .all();
    return rows.map((row) => row.id);
  }

  async rejectedBefore(cutoff: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: companyRegistration.id })
      .from(companyRegistration)
      .where(
        and(
          eq(companyRegistration.status, 'rejected'),
          lt(companyRegistration.decidedAt, new Date(cutoff)),
        ),
      )
      .all();
    return rows.map((row) => row.id);
  }

  deleteMany(ids: string[]): Statement {
    return this.db.delete(companyRegistration).where(inArray(companyRegistration.id, ids));
  }

  closeMany(ids: string[], now: number): Statement {
    return this.db
      .update(companyRegistration)
      .set({ status: 'closed', updatedAt: new Date(now) })
      .where(and(inArray(companyRegistration.id, ids), eq(companyRegistration.status, 'rejected')));
  }
}
