import {
  addIsoDays,
  EXPIRY_WARNING_DAYS,
  normalizeSearchText,
  type RecordKind,
  WORKFORCE_LIMITS,
  type WorkforceCategory,
  type WorkforceStatus,
} from '@hse/shared';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import type { Database } from '../../database/client';
import {
  workforceAssignment,
  type WorkforceAssignmentRow,
  workforceEmergencyContact,
  type WorkforceContactRow,
  workforceMember,
  type WorkforceMemberRow,
  workforceRecord,
  type WorkforceRecordRow,
} from './workforce.schema';

/** The kinds a reader's compliance summary counts (documents need `workforce.personal.view`). */
export function countedKinds(personal: boolean): RecordKind[] {
  return personal
    ? ['training', 'certificate', 'medical', 'document']
    : ['training', 'certificate', 'medical'];
}

export interface MemberFilters {
  search?: string;
  status?: WorkforceStatus;
  category?: WorkforceCategory;
  positionId?: string;
  nationality?: string;
  projectId?: string;
  attention: boolean;
  archived: boolean;
}

export interface AttentionScope {
  today: string;
  personal: boolean;
  contacts: boolean;
}

/** `search_key` of a profile (T-52). */
export function searchKeyOf(values: {
  fullName: string;
  altName: string | null;
  employeeId: string | null;
  employer: string;
}): string {
  return normalizeSearchText(
    [values.fullName, values.altName, values.employeeId, values.employer].filter(Boolean).join(' '),
  );
}

function likePattern(search: string): string {
  return `%${normalizeSearchText(search).replace(/[%_]/g, '')}%`;
}

/** Current = not voided and not replaced (T-48). */
const currentRecord = and(isNull(workforceRecord.voidedAt), isNull(workforceRecord.replacedAt));

/** Started, not ended, not cancelled on `today`. */
function currentAssignment(today: string): SQL {
  return (
    and(
      isNull(workforceAssignment.cancelledAt),
      lte(workforceAssignment.startDate, today),
      or(isNull(workforceAssignment.endDate), gte(workforceAssignment.endDate, today)),
    ) ?? sql`1`
  );
}

/**
 * PLT-20 FR-3: a person needs attention when a counted current record is expired or expiring,
 * the medical is missing or Unfit, or (for readers who see contacts) there is no contact.
 * Medical checks count by their latest current check only.
 */
function attentionCondition(scope: AttentionScope): SQL {
  const limit = addIsoDays(scope.today, EXPIRY_WARNING_DAYS);
  const kinds = countedKinds(scope.personal)
    .map((kind) => `'${kind}'`)
    .join(', ');
  const latestMedical = sql`(SELECT r2.id FROM workforce_record r2
      WHERE r2.workforce_member_id = ${workforceMember.id} AND r2.kind = 'medical'
        AND r2.voided_at IS NULL
      ORDER BY r2.issued_on DESC, r2.created_at DESC LIMIT 1)`;
  const parts: SQL[] = [
    sql`EXISTS (SELECT 1 FROM workforce_record r
        WHERE r.workforce_member_id = ${workforceMember.id} AND r.voided_at IS NULL
          AND r.replaced_at IS NULL AND r.kind IN (${sql.raw(kinds)})
          AND r.expires_on IS NOT NULL AND r.expires_on <= ${limit}
          AND (r.kind <> 'medical' OR r.id = ${latestMedical}))`,
    sql`${latestMedical} IS NULL`,
    sql`(SELECT r3.type FROM workforce_record r3 WHERE r3.id = ${latestMedical}) = 'unfit'`,
  ];
  if (scope.contacts) {
    parts.push(
      sql`NOT EXISTS (SELECT 1 FROM workforce_emergency_contact c
          WHERE c.workforce_member_id = ${workforceMember.id})`,
    );
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/** The only code that reads or writes the workforce tables (except the list items). */
export class WorkforceRepository {
  constructor(private readonly db: Database) {}

  // ---- Members ------------------------------------------------------------------------

  findMember(companyId: string, id: string): Promise<WorkforceMemberRow | undefined> {
    return this.db
      .select()
      .from(workforceMember)
      .where(and(eq(workforceMember.companyId, companyId), eq(workforceMember.id, id)))
      .get();
  }

  findMembers(companyId: string, ids: readonly string[]): Promise<WorkforceMemberRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(workforceMember)
      .where(and(eq(workforceMember.companyId, companyId), inArray(workforceMember.id, [...ids])))
      .all();
  }

  private memberConditions(companyId: string, filters: MemberFilters, scope: AttentionScope) {
    const conditions: SQL[] = [eq(workforceMember.companyId, companyId)];
    conditions.push(
      filters.archived ? isNotNull(workforceMember.archivedAt) : isNull(workforceMember.archivedAt),
    );
    if (filters.search)
      conditions.push(sql`${workforceMember.searchKey} LIKE ${likePattern(filters.search)}`);
    if (filters.status) conditions.push(eq(workforceMember.status, filters.status));
    if (filters.category) conditions.push(eq(workforceMember.category, filters.category));
    if (filters.positionId) conditions.push(eq(workforceMember.jobPositionId, filters.positionId));
    if (filters.nationality) conditions.push(eq(workforceMember.nationality, filters.nationality));
    if (filters.projectId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM workforce_assignment a
            WHERE a.workforce_member_id = ${workforceMember.id} AND a.project_id = ${filters.projectId}
              AND a.cancelled_at IS NULL AND a.start_date <= ${scope.today}
              AND (a.end_date IS NULL OR a.end_date >= ${scope.today}))`,
      );
    }
    if (filters.attention) conditions.push(attentionCondition(scope));
    return and(...conditions);
  }

  async listMembers(
    companyId: string,
    filters: MemberFilters,
    scope: AttentionScope,
    page: number,
  ): Promise<{ rows: WorkforceMemberRow[]; total: number }> {
    const where = this.memberConditions(companyId, filters, scope);
    const order = filters.attention
      ? [
          sql`(SELECT min(r.expires_on) FROM workforce_record r
              WHERE r.workforce_member_id = ${workforceMember.id} AND r.voided_at IS NULL
                AND r.replaced_at IS NULL AND r.expires_on IS NOT NULL) IS NULL`,
          sql`(SELECT min(r.expires_on) FROM workforce_record r
              WHERE r.workforce_member_id = ${workforceMember.id} AND r.voided_at IS NULL
                AND r.replaced_at IS NULL AND r.expires_on IS NOT NULL)`,
          asc(workforceMember.fullName),
        ]
      : [asc(workforceMember.fullName), asc(workforceMember.id)];
    const [rows, count] = await Promise.all([
      this.db
        .select()
        .from(workforceMember)
        .where(where)
        .orderBy(...order)
        .limit(WORKFORCE_LIMITS.pageSize)
        .offset((page - 1) * WORKFORCE_LIMITS.pageSize)
        .all(),
      this.db
        .select({ value: sql<number>`count(*)` })
        .from(workforceMember)
        .where(where)
        .get(),
    ]);
    return { rows, total: count?.value ?? 0 };
  }

  /** PLT-20 FR-4: profiles not archived. */
  async summary(
    companyId: string,
    scope: AttentionScope,
  ): Promise<{ total: number; active: number; needsAttention: number }> {
    const base = and(eq(workforceMember.companyId, companyId), isNull(workforceMember.archivedAt));
    const [total, active, attention] = await Promise.all([
      this.db
        .select({ value: sql<number>`count(*)` })
        .from(workforceMember)
        .where(base)
        .get(),
      this.db
        .select({ value: sql<number>`count(*)` })
        .from(workforceMember)
        .where(and(base, eq(workforceMember.status, 'active')))
        .get(),
      this.db
        .select({ value: sql<number>`count(*)` })
        .from(workforceMember)
        .where(and(base, attentionCondition(scope)))
        .get(),
    ]);
    return {
      total: total?.value ?? 0,
      active: active?.value ?? 0,
      needsAttention: attention?.value ?? 0,
    };
  }

  async countMembers(companyId: string): Promise<number> {
    const row = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(workforceMember)
      .where(eq(workforceMember.companyId, companyId))
      .get();
    return row?.value ?? 0;
  }

  /** O-80: profiles with the same name (ignoring case) and nationality. */
  sameNameAndNationality(
    companyId: string,
    fullName: string,
    nationality: string,
  ): Promise<WorkforceMemberRow[]> {
    return this.db
      .select()
      .from(workforceMember)
      .where(
        and(
          eq(workforceMember.companyId, companyId),
          eq(workforceMember.nationality, nationality),
          sql`lower(${workforceMember.fullName}) = ${fullName.toLocaleLowerCase('en')}`,
        ),
      )
      .limit(5)
      .all();
  }

  findByEmployeeId(companyId: string, key: string): Promise<WorkforceMemberRow | undefined> {
    return this.db
      .select()
      .from(workforceMember)
      .where(and(eq(workforceMember.companyId, companyId), eq(workforceMember.employeeIdKey, key)))
      .get();
  }

  /** Distinct values already used, for suggestions (O-82, O-95). */
  async suggestions(
    companyId: string,
    field: 'employer' | 'department' | 'training',
    query: string,
  ): Promise<string[]> {
    const pattern = `%${query.replace(/[%_]/g, '')}%`;
    if (field === 'training') {
      const rows = await this.db
        .selectDistinct({ value: workforceRecord.name })
        .from(workforceRecord)
        .where(
          and(
            eq(workforceRecord.companyId, companyId),
            eq(workforceRecord.kind, 'training'),
            sql`${workforceRecord.name} LIKE ${pattern}`,
          ),
        )
        .orderBy(asc(workforceRecord.name))
        .limit(10)
        .all();
      return rows.flatMap((row) => (row.value ? [row.value] : []));
    }
    const column = field === 'employer' ? workforceMember.employer : workforceMember.department;
    const rows = await this.db
      .selectDistinct({ value: column })
      .from(workforceMember)
      .where(
        and(
          eq(workforceMember.companyId, companyId),
          isNotNull(column),
          sql`${column} LIKE ${pattern}`,
        ),
      )
      .orderBy(asc(column))
      .limit(10)
      .all();
    return rows.flatMap((row) => (row.value ? [row.value] : []));
  }

  /** Assignable candidates (US-025 FR-2). */
  candidates(companyId: string, search: string | undefined): Promise<WorkforceMemberRow[]> {
    const conditions: SQL[] = [
      eq(workforceMember.companyId, companyId),
      isNull(workforceMember.archivedAt),
      inArray(workforceMember.status, ['active', 'on_leave']),
    ];
    if (search) conditions.push(sql`${workforceMember.searchKey} LIKE ${likePattern(search)}`);
    return this.db
      .select()
      .from(workforceMember)
      .where(and(...conditions))
      .orderBy(asc(workforceMember.fullName))
      .limit(WORKFORCE_LIMITS.pageSize)
      .all();
  }

  // ---- Assignments --------------------------------------------------------------------

  assignmentsOfMembers(memberIds: readonly string[]): Promise<WorkforceAssignmentRow[]> {
    if (memberIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(workforceAssignment)
      .where(inArray(workforceAssignment.workforceMemberId, [...memberIds]))
      .orderBy(desc(workforceAssignment.startDate))
      .all();
  }

  assignmentsOn(
    projectId: string,
    memberIds: readonly string[],
  ): Promise<WorkforceAssignmentRow[]> {
    if (memberIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(workforceAssignment)
      .where(
        and(
          eq(workforceAssignment.projectId, projectId),
          inArray(workforceAssignment.workforceMemberId, [...memberIds]),
          isNull(workforceAssignment.cancelledAt),
        ),
      )
      .all();
  }

  findAssignment(
    companyId: string,
    projectId: string,
    id: string,
  ): Promise<WorkforceAssignmentRow | undefined> {
    return this.db
      .select()
      .from(workforceAssignment)
      .where(
        and(
          eq(workforceAssignment.companyId, companyId),
          eq(workforceAssignment.projectId, projectId),
          eq(workforceAssignment.id, id),
        ),
      )
      .get();
  }

  async projectAssignments(
    companyId: string,
    projectId: string,
    query: {
      state: 'current' | 'upcoming' | 'ended' | 'all';
      positionId?: string;
      search?: string;
      attention: boolean;
      page: number;
    },
    scope: AttentionScope,
  ): Promise<{
    rows: { assignment: WorkforceAssignmentRow; member: WorkforceMemberRow }[];
    total: number;
  }> {
    const today = scope.today;
    const conditions: SQL[] = [
      eq(workforceAssignment.companyId, companyId),
      eq(workforceAssignment.projectId, projectId),
    ];
    if (query.state === 'current') conditions.push(currentAssignment(today));
    if (query.state === 'upcoming') {
      conditions.push(
        isNull(workforceAssignment.cancelledAt),
        sql`${workforceAssignment.startDate} > ${today}`,
      );
    }
    if (query.state === 'ended') {
      conditions.push(
        or(
          isNotNull(workforceAssignment.cancelledAt),
          sql`${workforceAssignment.endDate} < ${today}`,
        ) ?? sql`0`,
      );
    }
    if (query.positionId) conditions.push(eq(workforceAssignment.jobPositionId, query.positionId));
    if (query.search)
      conditions.push(sql`${workforceMember.searchKey} LIKE ${likePattern(query.search)}`);
    if (query.attention) conditions.push(attentionCondition(scope));
    const where = and(...conditions);
    const [rows, count] = await Promise.all([
      this.db
        .select({ assignment: workforceAssignment, member: workforceMember })
        .from(workforceAssignment)
        .innerJoin(workforceMember, eq(workforceMember.id, workforceAssignment.workforceMemberId))
        .where(where)
        .orderBy(asc(workforceMember.fullName), desc(workforceAssignment.startDate))
        .limit(WORKFORCE_LIMITS.pageSize)
        .offset((query.page - 1) * WORKFORCE_LIMITS.pageSize)
        .all(),
      this.db
        .select({ value: sql<number>`count(*)` })
        .from(workforceAssignment)
        .innerJoin(workforceMember, eq(workforceMember.id, workforceAssignment.workforceMemberId))
        .where(where)
        .get(),
    ]);
    return { rows, total: count?.value ?? 0 };
  }

  /**
   * Assignments of a person still open after today (status change, archive): an assignment that
   * ends today counts as closed, so a person terminated today can be archived today.
   */
  openAssignments(memberId: string, today: string): Promise<WorkforceAssignmentRow[]> {
    return this.db
      .select()
      .from(workforceAssignment)
      .where(
        and(
          eq(workforceAssignment.workforceMemberId, memberId),
          isNull(workforceAssignment.cancelledAt),
          or(isNull(workforceAssignment.endDate), gt(workforceAssignment.endDate, today)),
        ),
      )
      .all();
  }

  /** Current assignments of people on a day (directory rows, digest recipients). */
  currentAssignments(
    memberIds: readonly string[],
    today: string,
  ): Promise<WorkforceAssignmentRow[]> {
    if (memberIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(workforceAssignment)
      .where(
        and(
          inArray(workforceAssignment.workforceMemberId, [...memberIds]),
          currentAssignment(today),
        ),
      )
      .all();
  }

  /** Daily job: open assignments whose end date is between two days (all companies). */
  assignmentsEndingBetween(from: string, to: string): Promise<WorkforceAssignmentRow[]> {
    return this.db
      .select()
      .from(workforceAssignment)
      .where(
        and(
          isNull(workforceAssignment.cancelledAt),
          gte(workforceAssignment.endDate, from),
          lte(workforceAssignment.endDate, to),
        ),
      )
      .all();
  }

  // ---- Records ------------------------------------------------------------------------

  records(memberId: string, kind: RecordKind): Promise<WorkforceRecordRow[]> {
    return this.db
      .select()
      .from(workforceRecord)
      .where(and(eq(workforceRecord.workforceMemberId, memberId), eq(workforceRecord.kind, kind)))
      .orderBy(desc(workforceRecord.issuedOn), desc(workforceRecord.createdAt))
      .all();
  }

  findRecord(
    companyId: string,
    memberId: string,
    kind: RecordKind,
    id: string,
  ): Promise<WorkforceRecordRow | undefined> {
    return this.db
      .select()
      .from(workforceRecord)
      .where(
        and(
          eq(workforceRecord.companyId, companyId),
          eq(workforceRecord.workforceMemberId, memberId),
          eq(workforceRecord.kind, kind),
          eq(workforceRecord.id, id),
        ),
      )
      .get();
  }

  /** Not voided records (medical: every check; others: current and replaced). */
  liveRecordsOf(memberIds: readonly string[]): Promise<WorkforceRecordRow[]> {
    if (memberIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(workforceRecord)
      .where(and(inArray(workforceRecord.workforceMemberId, [...memberIds]), currentRecord))
      .all();
  }

  /** O-80: a current document with the same type, country and number in the company. */
  sameDocumentNumber(
    companyId: string,
    type: string,
    country: string | null,
    numberKey: string,
    exceptIds: readonly string[],
  ): Promise<WorkforceRecordRow | undefined> {
    const conditions: SQL[] = [
      eq(workforceRecord.companyId, companyId),
      eq(workforceRecord.kind, 'document'),
      eq(workforceRecord.type, type),
      eq(workforceRecord.numberKey, numberKey),
      currentRecord ?? sql`1`,
      country === null ? isNull(workforceRecord.country) : eq(workforceRecord.country, country),
    ];
    for (const id of exceptIds) conditions.push(ne(workforceRecord.id, id));
    return this.db
      .select()
      .from(workforceRecord)
      .where(and(...conditions))
      .get();
  }

  /** Records replaced by these ids (the "replaced by" link). */
  async replacements(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: workforceRecord.id, replacesId: workforceRecord.replacesId })
      .from(workforceRecord)
      .where(inArray(workforceRecord.replacesId, [...ids]))
      .all();
    return new Map(rows.flatMap((row) => (row.replacesId ? [[row.replacesId, row.id]] : [])));
  }

  /** Daily job: current records expiring between two days (all companies). */
  recordsExpiringBetween(from: string, to: string): Promise<WorkforceRecordRow[]> {
    return this.db
      .select()
      .from(workforceRecord)
      .where(
        and(
          currentRecord,
          gte(workforceRecord.expiresOn, from),
          lte(workforceRecord.expiresOn, to),
        ),
      )
      .all();
  }

  // ---- Contacts -----------------------------------------------------------------------

  contacts(memberId: string): Promise<WorkforceContactRow[]> {
    return this.db
      .select()
      .from(workforceEmergencyContact)
      .where(eq(workforceEmergencyContact.workforceMemberId, memberId))
      .orderBy(asc(workforceEmergencyContact.position))
      .all();
  }

  async contactCounts(memberIds: readonly string[]): Promise<Map<string, number>> {
    if (memberIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: workforceEmergencyContact.workforceMemberId, value: sql<number>`count(*)` })
      .from(workforceEmergencyContact)
      .where(inArray(workforceEmergencyContact.workforceMemberId, [...memberIds]))
      .groupBy(workforceEmergencyContact.workforceMemberId)
      .all();
    return new Map(rows.map((row) => [row.id, row.value]));
  }
}
