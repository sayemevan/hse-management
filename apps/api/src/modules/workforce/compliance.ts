import {
  type ComplianceSummaryDto,
  expiryState,
  type MedicalFitness,
  type MedicalStatusDto,
} from '@hse/shared';

import { countedKinds } from './workforce.repository';
import type { WorkforceRecordRow } from './workforce.schema';

export interface ComplianceScope {
  today: string;
  personal: boolean;
  contacts: boolean;
}

/** The latest current medical check: the person's medical status (US-028 FR-2). */
export function latestMedical(rows: readonly WorkforceRecordRow[]): WorkforceRecordRow | null {
  let latest: WorkforceRecordRow | null = null;
  for (const row of rows) {
    if (row.kind !== 'medical' || row.voidedAt) continue;
    if (
      !latest ||
      (row.issuedOn ?? '') > (latest.issuedOn ?? '') ||
      (row.issuedOn === latest.issuedOn && row.createdAt.getTime() > latest.createdAt.getTime())
    ) {
      latest = row;
    }
  }
  return latest;
}

export function medicalStatus(
  rows: readonly WorkforceRecordRow[],
  today: string,
): MedicalStatusDto {
  const latest = latestMedical(rows);
  if (!latest) {
    return { fitness: null, expiryState: 'none', expiresOn: null, hasRestrictions: false };
  }
  return {
    fitness: latest.type as MedicalFitness,
    expiryState: expiryState(latest.expiresOn, today),
    expiresOn: latest.expiresOn,
    hasRestrictions: latest.type === 'fit_with_restrictions',
  };
}

/**
 * PLT-20: the compliance summary of one person from their current records (T-50). Documents
 * count only for readers with `workforce.personal.view`; the contact flag only for readers who
 * see contacts.
 */
export function complianceOf(
  records: readonly WorkforceRecordRow[],
  contactCount: number,
  scope: ComplianceScope,
): ComplianceSummaryDto {
  const kinds = new Set(countedKinds(scope.personal));
  const medical = latestMedical(records);
  let expired = 0;
  let expiring = 0;
  let nearest: ComplianceSummaryDto['nearest'] = null;
  for (const row of records) {
    if (!kinds.has(row.kind) || row.voidedAt || row.replacedAt) continue;
    if (row.kind === 'medical' && row.id !== medical?.id) continue;
    const state = expiryState(row.expiresOn, scope.today);
    if (state !== 'expired' && state !== 'expiring') continue;
    if (state === 'expired') expired += 1;
    else expiring += 1;
    if (row.expiresOn && (!nearest || row.expiresOn < nearest.expiresOn)) {
      nearest = { kind: row.kind, name: row.name ?? '', type: row.type, expiresOn: row.expiresOn };
    }
  }
  const medicalMissing = medical === null;
  const medicalUnfit = medical?.type === 'unfit';
  const noEmergencyContact = scope.contacts ? contactCount === 0 : undefined;
  const worst = expired > 0 ? 'expired' : expiring > 0 ? 'expiring' : 'ok';
  const badge =
    worst !== 'ok'
      ? worst
      : medicalMissing || medicalUnfit || noEmergencyContact === true
        ? 'check'
        : 'ok';
  return {
    badge,
    worst,
    expired,
    expiring,
    medicalMissing,
    medicalUnfit,
    ...(noEmergencyContact === undefined ? {} : { noEmergencyContact }),
    nearest,
  };
}
