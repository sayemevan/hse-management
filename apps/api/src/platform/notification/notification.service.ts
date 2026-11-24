import {
  generateId,
  NOTIFICATION_RETENTION_DAYS,
  type NotificationParams,
  type NotificationType,
} from '@hse/shared';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { notification, type NotificationRow } from './notification.schema';

/** PLT-17 FR-1. Written in the caller's `UnitOfWork`, one row per recipient (T-40). */
export interface NotificationEvent {
  type: NotificationType;
  companyId: string;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Never notified about their own change (T-41). `null` = the system. */
  actorUserId: string | null;
  params: NotificationParams;
  recipients: Iterable<string>;
}

/** Server-side guard: parameters are short names and codes, never documents. */
export const NOTIFICATION_PARAMS_MAX_BYTES = 2048;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NotificationCursor {
  createdAt: number;
  id: string;
}

export function parseCursor(value: string | undefined): NotificationCursor | null {
  if (!value) return null;
  const [createdAt, id] = value.split('_');
  return createdAt && id ? { createdAt: Number(createdAt), id } : null;
}

export function cursorOf(row: { createdAt: Date; id: string }): string {
  return `${String(row.createdAt.getTime())}_${row.id}`;
}

/**
 * The one notification service for every module (Master Rules §6, PLT-17). Reads are always
 * scoped to one recipient in one company (FR-11).
 */
export class NotificationService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  entries(event: NotificationEvent): Statement[] {
    const params = JSON.stringify(event.params);
    if (new TextEncoder().encode(params).length > NOTIFICATION_PARAMS_MAX_BYTES) {
      throw new Error(`Notification params too large for ${event.type}`);
    }
    const recipients = new Set(event.recipients);
    if (event.actorUserId) recipients.delete(event.actorUserId);
    const createdAt = new Date(this.clock());
    return [...recipients].map((recipientUserId) =>
      this.db.insert(notification).values({
        id: generateId(),
        companyId: event.companyId,
        recipientUserId,
        type: event.type,
        params,
        actorUserId: event.actorUserId,
        projectId: event.projectId ?? null,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        createdAt,
        readAt: null,
      }),
    );
  }

  /** FR-5. */
  async unreadCount(userId: string, companyId: string): Promise<number> {
    const row = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(notification)
      .where(
        and(
          eq(notification.recipientUserId, userId),
          eq(notification.companyId, companyId),
          isNull(notification.readAt),
        ),
      )
      .get();
    return row?.value ?? 0;
  }

  /** FR-6: newest first; one extra row is read to know whether there is a next page. */
  async list(
    userId: string,
    companyId: string,
    query: { unread: boolean; before: NotificationCursor | null; limit: number },
  ): Promise<{ rows: NotificationRow[]; next: string | null }> {
    const conditions = [
      eq(notification.recipientUserId, userId),
      eq(notification.companyId, companyId),
    ];
    if (query.unread) conditions.push(isNull(notification.readAt));
    if (query.before) {
      const at = new Date(query.before.createdAt);
      const older = or(
        lt(notification.createdAt, at),
        and(eq(notification.createdAt, at), lt(notification.id, query.before.id)),
      );
      if (older) conditions.push(older);
    }
    const rows = await this.db
      .select()
      .from(notification)
      .where(and(...conditions))
      .orderBy(desc(notification.createdAt), desc(notification.id))
      .limit(query.limit + 1)
      .all();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { rows: page, next: rows.length > query.limit && last ? cursorOf(last) : null };
  }

  find(userId: string, companyId: string, id: string): Promise<NotificationRow | undefined> {
    return this.db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.id, id),
          eq(notification.recipientUserId, userId),
          eq(notification.companyId, companyId),
        ),
      )
      .get();
  }

  /** FR-7: idempotent; only the reader's own. */
  async markRead(userId: string, companyId: string, id: string): Promise<void> {
    await this.db
      .update(notification)
      .set({ readAt: new Date(this.clock()) })
      .where(
        and(
          eq(notification.id, id),
          eq(notification.recipientUserId, userId),
          eq(notification.companyId, companyId),
          isNull(notification.readAt),
        ),
      )
      .run();
  }

  async markAllRead(userId: string, companyId: string): Promise<number> {
    const result = await this.db
      .update(notification)
      .set({ readAt: new Date(this.clock()) })
      .where(
        and(
          eq(notification.recipientUserId, userId),
          eq(notification.companyId, companyId),
          isNull(notification.readAt),
        ),
      )
      .run();
    return result.meta.changes;
  }

  /** FR-9 (O-63): removes notifications older than one year, 500 at a time. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(this.clock() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
    let removed = 0;
    for (;;) {
      const ids = (
        await this.db
          .select({ id: notification.id })
          .from(notification)
          .where(lt(notification.createdAt, cutoff))
          .limit(500)
          .all()
      ).map((row) => row.id);
      if (ids.length === 0) return removed;
      await this.db.delete(notification).where(inArray(notification.id, ids)).run();
      removed += ids.length;
    }
  }
}
