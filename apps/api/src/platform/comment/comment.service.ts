import { COMMENT_LIMITS, ErrorCode, generateId } from '@hse/shared';
import { and, desc, eq, gt, lt, or, sql } from 'drizzle-orm';

import { AppError, ForbiddenError } from '../../core/errors/app-error';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import type { AuditLogService } from '../audit-log';
import { comment, type CommentRow } from './comment.schema';

/**
 * What a module says about one of its records when it turns comments on (PLT-22, T-63). The
 * module loads it with its own permission checks and passes it to the service; the routes are
 * mounted under the module's record.
 */
export interface CommentTarget {
  companyId: string;
  projectId: string | null;
  entityType: string;
  entityId: string;
  /** Closed or voided records: the thread is read-only (O-105, O-110). */
  locked: boolean;
}

export class CommentEditWindowPassedError extends AppError {
  constructor() {
    super(
      ErrorCode.COMMENT_EDIT_WINDOW_PASSED,
      409,
      'Comments can only be edited for 15 minutes after posting.',
    );
  }
}

export class CommentsLockedError extends AppError {
  constructor() {
    super(ErrorCode.COMMENTS_LOCKED, 409, 'This record is closed. Comments are read-only.');
  }
}

export interface CommentCursor {
  createdAt: number;
  id: string;
}

export function parseCommentCursor(value: string | undefined): CommentCursor | null {
  if (!value) return null;
  const [createdAt, id] = value.split('_');
  return createdAt && id ? { createdAt: Number(createdAt), id } : null;
}

/** The one comment service for every module (Doc 04 §11, PLT-22). Comments are never deleted. */
export class CommentService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditLogService,
    private readonly clock: () => number = Date.now,
  ) {}

  /** FR-3: pages from the newest back; each page oldest first. */
  async list(
    target: CommentTarget,
    before: CommentCursor | null,
  ): Promise<{ rows: CommentRow[]; nextBefore: string | null }> {
    const conditions = [
      eq(comment.companyId, target.companyId),
      eq(comment.entityType, target.entityType),
      eq(comment.entityId, target.entityId),
    ];
    if (before) {
      const at = new Date(before.createdAt);
      const older = or(
        lt(comment.createdAt, at),
        and(eq(comment.createdAt, at), lt(comment.id, before.id)),
      );
      if (older) conditions.push(older);
    }
    const rows = await this.db
      .select()
      .from(comment)
      .where(and(...conditions))
      .orderBy(desc(comment.createdAt), desc(comment.id))
      .limit(COMMENT_LIMITS.pageSize + 1)
      .all();
    const page = rows.slice(0, COMMENT_LIMITS.pageSize);
    const oldest = page.at(-1);
    return {
      rows: page.reverse(),
      nextBefore:
        rows.length > COMMENT_LIMITS.pageSize && oldest
          ? `${String(oldest.createdAt.getTime())}_${oldest.id}`
          : null,
    };
  }

  find(target: CommentTarget, id: string): Promise<CommentRow | undefined> {
    return this.db
      .select()
      .from(comment)
      .where(
        and(
          eq(comment.id, id),
          eq(comment.companyId, target.companyId),
          eq(comment.entityType, target.entityType),
          eq(comment.entityId, target.entityId),
        ),
      )
      .get();
  }

  /** FR-8: comments the author posted in the last minute (any record). */
  async recentCount(authorId: string): Promise<number> {
    const since = new Date(this.clock() - 60_000);
    const row = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(comment)
      .where(and(eq(comment.authorId, authorId), gt(comment.createdAt, since)))
      .get();
    return row?.value ?? 0;
  }

  /** FR-4: the comment and its audit entry, for the caller's `UnitOfWork`. */
  add(
    target: CommentTarget,
    authorId: string,
    body: string,
  ): { row: CommentRow; statements: Statement[] } {
    if (target.locked) throw new CommentsLockedError();
    const row: CommentRow = {
      id: generateId(),
      companyId: target.companyId,
      projectId: target.projectId,
      entityType: target.entityType,
      entityId: target.entityId,
      authorId,
      body,
      createdAt: new Date(this.clock()),
      editedAt: null,
    };
    return {
      row,
      statements: [
        this.db.insert(comment).values(row),
        this.audit.entry({
          action: 'comment.created',
          actorUserId: authorId,
          companyId: target.companyId,
          projectId: target.projectId,
          entityType: 'comment',
          entityId: row.id,
          newValue: { entityType: target.entityType, entityId: target.entityId, length: body.length },
        }),
      ],
    };
  }

  /** FR-5: the author only, within 15 minutes, while the record isn't locked. */
  edit(
    target: CommentTarget,
    row: CommentRow,
    authorId: string,
    body: string,
  ): { row: CommentRow; statements: Statement[] } {
    if (target.locked) throw new CommentsLockedError();
    if (row.authorId !== authorId) throw new ForbiddenError();
    if (!this.editable(row, authorId)) throw new CommentEditWindowPassedError();
    const editedAt = new Date(this.clock());
    return {
      row: { ...row, body, editedAt },
      statements: [
        this.db.update(comment).set({ body, editedAt }).where(eq(comment.id, row.id)),
        this.audit.entry({
          action: 'comment.edited',
          actorUserId: authorId,
          companyId: target.companyId,
          projectId: target.projectId,
          entityType: 'comment',
          entityId: row.id,
          oldValue: { body: row.body },
          newValue: { body },
        }),
      ],
    };
  }

  editable(row: CommentRow, userId: string): boolean {
    return (
      row.authorId === userId &&
      this.clock() - row.createdAt.getTime() <= COMMENT_LIMITS.editWindowMs
    );
  }
}
