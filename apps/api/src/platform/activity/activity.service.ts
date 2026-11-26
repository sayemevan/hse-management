import {
  ACTIVITY_LONG_VALUE,
  ACTIVITY_VALUE_MAX,
  type ActivityAction,
  type ActivityChanges,
  type ActivitySnapshot,
  generateId,
} from '@hse/shared';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { activityEntry, type ActivityEntryRow } from './activity.schema';

/** PLT-18 FR-1. */
export interface ActivityEvent {
  action: ActivityAction;
  companyId: string;
  projectId?: string | null;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  changes?: ActivityChanges | null;
  snapshot?: ActivitySnapshot;
  /** Several entries of one change keep their order (default: now). */
  occurredAt?: number;
}

/** FR-5: long texts are recorded as "changed" without the text. */
function shorten(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'string' && value.length > ACTIVITY_VALUE_MAX ? ACTIVITY_LONG_VALUE : value,
    ]),
  );
}

export interface ActivityCursor {
  occurredAt: number;
  id: string;
}

export function parseActivityCursor(value: string | undefined): ActivityCursor | null {
  if (!value) return null;
  const [occurredAt, id] = value.split('_');
  return occurredAt && id ? { occurredAt: Number(occurredAt), id } : null;
}

/**
 * The activity timeline for every module (PLT-18, T-43). Append-only: there is deliberately no
 * update or delete, and the database refuses both.
 */
export class ActivityService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  entry(event: ActivityEvent): Statement {
    return this.db.insert(activityEntry).values({
      id: generateId(),
      companyId: event.companyId,
      projectId: event.projectId ?? null,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      actorUserId: event.actorUserId,
      changes: event.changes
        ? JSON.stringify({
            before: shorten(event.changes.before),
            after: shorten(event.changes.after),
          })
        : null,
      snapshot: JSON.stringify(event.snapshot ?? {}),
      occurredAt: new Date(event.occurredAt ?? this.clock()),
    });
  }

  /** FR-6: a project's entries, newest first. */
  async listForProject(
    companyId: string,
    projectId: string,
    query: { actions: readonly string[]; before: ActivityCursor | null; limit: number },
  ): Promise<{ rows: ActivityEntryRow[]; next: string | null }> {
    if (query.actions.length === 0) return { rows: [], next: null };
    const conditions = [
      eq(activityEntry.companyId, companyId),
      eq(activityEntry.projectId, projectId),
      inArray(activityEntry.action, [...query.actions]),
    ];
    if (query.before) {
      const at = new Date(query.before.occurredAt);
      const older = or(
        lt(activityEntry.occurredAt, at),
        and(eq(activityEntry.occurredAt, at), lt(activityEntry.id, query.before.id)),
      );
      if (older) conditions.push(older);
    }
    const rows = await this.db
      .select()
      .from(activityEntry)
      .where(and(...conditions))
      .orderBy(desc(activityEntry.occurredAt), desc(activityEntry.id))
      .limit(query.limit + 1)
      .all();
    return page(rows, query.limit);
  }

  /** One record's entries (a workforce profile's History tab, T-56), newest first. */
  async listForEntity(
    companyId: string,
    entity: { type: string; id: string },
    query: { before: ActivityCursor | null; limit: number },
  ): Promise<{ rows: ActivityEntryRow[]; next: string | null }> {
    const conditions = [
      eq(activityEntry.companyId, companyId),
      eq(activityEntry.entityType, entity.type),
      eq(activityEntry.entityId, entity.id),
    ];
    if (query.before) {
      const at = new Date(query.before.occurredAt);
      const older = or(
        lt(activityEntry.occurredAt, at),
        and(eq(activityEntry.occurredAt, at), lt(activityEntry.id, query.before.id)),
      );
      if (older) conditions.push(older);
    }
    const rows = await this.db
      .select()
      .from(activityEntry)
      .where(and(...conditions))
      .orderBy(desc(activityEntry.occurredAt), desc(activityEntry.id))
      .limit(query.limit + 1)
      .all();
    return page(rows, query.limit);
  }
}

function page(
  rows: ActivityEntryRow[],
  limit: number,
): { rows: ActivityEntryRow[]; next: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    rows: items,
    next: rows.length > limit && last ? `${String(last.occurredAt.getTime())}_${last.id}` : null,
  };
}

/** The fields whose values differ, as `{ before, after }`; null when nothing changed. */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ActivityChanges | null {
  const result: ActivityChanges = { before: {}, after: {} };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === after[key]) continue;
    result.before[key] = before[key] ?? null;
    result.after[key] = after[key] ?? null;
  }
  return Object.keys(result.after).length > 0 ? result : null;
}
