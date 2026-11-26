import { z } from 'zod';

/** The comment service (PLT-22, T-63, O-110). */
export const COMMENT_LIMITS = {
  bodyMax: 2000,
  /** O-110: the author may edit for this long after posting. */
  editWindowMs: 15 * 60 * 1000,
  pageSize: 30,
  /** PLT-22 FR-8. */
  postsPerMinute: 30,
  /** PLT-22 § Notifications: comments within this window update one unread notification. */
  groupWindowMs: 10 * 60 * 1000,
} as const;

export const commentRequestSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_LIMITS.bodyMax),
});
export type CommentRequest = z.input<typeof commentRequestSchema>;

export const commentListQuerySchema = z.object({
  before: z
    .string()
    .regex(/^\d+_[0-9a-f-]{36}$/)
    .optional(),
});

export interface CommentDto {
  id: string;
  author: { id: string; name: string; stillHasAccess: boolean };
  body: string;
  createdAt: number;
  editedAt: number | null;
  canEdit: boolean;
}

export interface CommentPageDto {
  /** Oldest first within the page. */
  comments: CommentDto[];
  /** Cursor for earlier comments, or null. */
  nextBefore: string | null;
  locked: boolean;
}
