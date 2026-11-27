import { z } from 'zod';

/**
 * In-app notification types (PLT-17, O-64). Every module adds its types here; the API stores
 * the type and its parameters, and the web app writes the sentence in the reader's language
 * when it shows it (T-40).
 */
export const NOTIFICATION_TYPES = [
  'project.member.added',
  'project.member.joined',
  'project.member.role_changed',
  'project.member.removed',
  'project.member.access_ending',
  'company.role.changed',
  'project.status.changed',
  'project.archived',
  'project.restored',
  'role.permissions.changed',
  'user.locked',
  'subscription.reminder',
  // Sprint 7 (PLT-20, US-024, US-025)
  'workforce.attention.digest',
  'workforce.record.expiring',
  'workforce.assignment.added',
  'workforce.member.suspended',
  // Sprint 8 (PLT-23 § Notifications, O-109)
  'action.assigned',
  'action.unassigned',
  'action.collaborator_added',
  'action.due_tomorrow',
  'action.overdue',
  'action.due_digest',
  'action.verification_needed',
  'action.sent_back',
  'action.verified',
  'action.closed',
  'action.voided',
  'action.due_date_changed',
  'action.comment_added',
  'action.owner_lost_access',
  // Sprint 9 (PLT-30, O-131)
  'sync.conflict',
  // Sprint 10 (O-150)
  'inspection.assigned',
  'inspection.unassigned',
  'inspection.submitted',
  'inspection.returned',
  'inspection.approved',
  'inspection.closed',
  'inspection.cancelled',
  'inspection.overdue',
  'inspection.review_waiting',
  'inspection.comment_added',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** O-63: notifications are removed one year after they were created. */
export const NOTIFICATION_RETENTION_DAYS = 365;

/** T-42: the web app asks for the unread count this often while the tab is visible. */
export const NOTIFICATION_POLL_MS = 60_000;

/** Parameters stored with each type (names as they were when it happened, PLT-17 FR-4). */
export interface NotificationParams {
  projectCode?: string;
  projectName?: string;
  roleCode?: string;
  memberName?: string;
  status?: string;
  validUntil?: string | null;
  /** `project.member.access_ending`: the reader is the member (true) or the assigner. */
  self?: boolean;
  reset?: boolean;
  userName?: string;
  /** `subscription.reminder`: the reminder template, e.g. `subscription.trial_ending`. */
  reminder?: string;
  daysLeft?: number;
  deadline?: number;
  // Sprint 7
  /** `workforce.attention.digest`: item counts. */
  count?: number;
  expired?: number;
  expiring?: number;
  ending?: number;
  /** `workforce.record.expiring`: the record (kind, type or name) and its date. */
  recordKind?: string;
  recordType?: string | null;
  recordName?: string | null;
  expiresOn?: string;
  positionName?: string | null;
  positionKey?: string | null;
  startDate?: string;
  since?: string;
  // Sprint 8
  /** `RMX-02-ACT-0012`. */
  actionReference?: string;
  /** The first 80 characters of the title. */
  actionTitle?: string;
  priority?: string;
  dueOn?: string;
  daysOverdue?: number;
  /** `action.due_digest`: counts. */
  overdue?: number;
  dueToday?: number;
  /** Critical actions among the overdue ones (listed every day until resolved, T-64). */
  critical?: number;
  /** `action.sent_back` / `action.voided`: the first 120 characters of the reason. */
  reason?: string;
  // Sprint 9
  /** `sync.conflict`: what the offline change was about, and whether this is the reminder. */
  recordLabel?: string;
  conflictId?: string;
  again?: boolean;
  // Sprint 10
  /** `RMX-02-INS-0012`, or null before the number is given. */
  inspectionReference?: string | null;
  /** The template name in both languages (T-80); the web app picks the reader's. */
  templateNameEn?: string | null;
  templateNameAr?: string | null;
  plannedOn?: string | null;
}

export const notificationListQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  /** Cursor: `<createdAt>_<id>` of the last row of the previous page. */
  before: z
    .string()
    .regex(/^\d+_[0-9a-f-]{36}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export interface NotificationDto {
  id: string;
  type: NotificationType;
  params: NotificationParams;
  actorName: string | null;
  projectId: string | null;
  createdAt: number;
  readAt: number | null;
}

export interface NotificationPageDto {
  items: NotificationDto[];
  nextBefore: string | null;
}

export interface NotificationOpenDto {
  /** The web route to open, or null when the reader can no longer see the record (T-41). */
  route: string | null;
  access: boolean;
}
