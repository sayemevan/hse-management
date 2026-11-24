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
