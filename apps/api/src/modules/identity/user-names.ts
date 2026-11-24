import { inArray } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { user } from './identity.schema';
import { UserRepository } from './user.repository';

/** Display names by user id, for showing who changed a record (US-018 "archived by"). */
export function userNames(db: Database, ids: readonly string[]): Promise<Map<string, string>> {
  return new UserRepository(db).namesByIds(ids);
}

export interface UserSummary {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  companyId: string | null;
  /** Archived or removed: shown as "(former user)" (PLT-18 FR-9). */
  former: boolean;
}

/** Name, contact and status by user id (members list, timeline). */
export async function userSummaries(
  db: Database,
  ids: readonly string[],
): Promise<Map<string, UserSummary>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      companyId: user.companyId,
      deletedAt: user.deletedAt,
    })
    .from(user)
    .where(inArray(user.id, unique))
    .all();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        status: row.status,
        companyId: row.companyId,
        former: row.status === 'archived' || row.deletedAt !== null,
      },
    ]),
  );
}
