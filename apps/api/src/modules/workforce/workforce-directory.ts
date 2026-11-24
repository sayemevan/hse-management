import type { ComplianceSummaryDto, MedicalStatusDto, WorkforceStatus } from '@hse/shared';

import type { Database } from '../../database/client';
import { complianceOf, medicalStatus } from './compliance';
import { WorkforceRepository } from './workforce.repository';
import { assignmentState } from './workforce-views';

export interface ResolvedWorkforceMember {
  id: string;
  fullName: string;
  altName: string | null;
  employeeId: string | null;
  jobPositionId: string;
  status: WorkforceStatus;
  archived: boolean;
}

export interface WorkforceAvailability {
  member: ResolvedWorkforceMember;
  /** The assignment in force on the project that day, if any. */
  assignmentId: string | null;
  medical: MedicalStatusDto;
  compliance: ComplianceSummaryDto;
  /** Later modules accept Active people only for operational work (O-78). */
  operational: boolean;
}

/**
 * What other modules may know about the workforce (T-47, T-35). Permits, toolbox talks and
 * inspections use this contract and never read the workforce tables.
 */
export class WorkforceDirectory {
  private readonly repo: WorkforceRepository;

  constructor(db: Database) {
    this.repo = new WorkforceRepository(db);
  }

  async resolve(
    companyId: string,
    memberIds: readonly string[],
  ): Promise<Map<string, ResolvedWorkforceMember>> {
    const rows = await this.repo.findMembers(companyId, [...new Set(memberIds)]);
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          fullName: row.fullName,
          altName: row.altName,
          employeeId: row.employeeId,
          jobPositionId: row.jobPositionId,
          status: row.status,
          archived: row.archivedAt !== null,
        },
      ]),
    );
  }

  /** Is this person available for work on this project on this day (calendar day `today`)? */
  async availability(
    companyId: string,
    memberId: string,
    projectId: string,
    today: string,
  ): Promise<WorkforceAvailability | null> {
    const member = (await this.resolve(companyId, [memberId])).get(memberId);
    if (!member) return null;
    const [assignments, records, contacts] = await Promise.all([
      this.repo.assignmentsOn(projectId, [memberId]),
      this.repo.liveRecordsOf([memberId]),
      this.repo.contactCounts([memberId]),
    ]);
    const current = assignments.find((row) => assignmentState(row, today) === 'current');
    const compliance = complianceOf(records, contacts.get(memberId) ?? 0, {
      today,
      personal: true,
      contacts: true,
    });
    const medical = medicalStatus(records, today);
    return {
      member,
      assignmentId: current?.id ?? null,
      medical,
      compliance,
      operational:
        member.status === 'active' &&
        !member.archived &&
        current !== undefined &&
        medical.fitness !== 'unfit' &&
        medical.expiryState !== 'expired',
    };
  }
}
