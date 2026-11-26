import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { recordCounter } from './record-counter.schema';

/**
 * Per-project record numbers (T-60). A module reads the next number with `peek`, writes its
 * record with that number (under a unique index on project and number) and adds `claim` to the
 * same batch. If another request took the number first, the unique index fails the whole batch
 * and the module tries again with a fresh `peek` (`withRecordNumber`). So numbers never repeat
 * and a failed change uses none.
 */
export class RecordNumbers {
  constructor(private readonly db: Database) {}

  async peek(projectId: string, kind: string): Promise<number> {
    const row = await this.db
      .select({ next: recordCounter.nextValue })
      .from(recordCounter)
      .where(and(eq(recordCounter.projectId, projectId), eq(recordCounter.kind, kind)))
      .get();
    return row?.next ?? 1;
  }

  /** Moves the counter past `number` (never backwards). */
  claim(projectId: string, kind: string, number: number): Statement {
    return this.db
      .insert(recordCounter)
      .values({ projectId, kind, nextValue: number + 1 })
      .onConflictDoUpdate({
        target: [recordCounter.projectId, recordCounter.kind],
        set: { nextValue: sql`max(${recordCounter.nextValue}, excluded.next_value)` },
      });
  }
}

const ATTEMPTS = 40;

function isNumberConflict(error: unknown, uniqueIndex: string): boolean {
  const text = String((error as { message?: unknown } | null)?.message ?? error);
  return text.includes('UNIQUE constraint failed') && text.includes(uniqueIndex);
}

/**
 * Runs `attempt` until its batch commits without a number conflict on `uniqueIndex` (the
 * columns named in SQLite's message, e.g. `action.project_id, action.number`).
 */
export async function withRecordNumber<T>(
  uniqueIndex: string,
  attempt: () => Promise<T>,
): Promise<T> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= ATTEMPTS || !isNumberConflict(error, uniqueIndex)) throw error;
    }
  }
}
