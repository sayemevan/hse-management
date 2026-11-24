import { z } from 'zod';

/**
 * Activity timeline actions (PLT-18, T-43). Each belongs to one filter group. Later modules add
 * their actions here. The web app writes the sentence in the reader's language.
 */
export const ACTIVITY_GROUPS = ['project', 'members', 'structure', 'workforce'] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export const ACTIVITY_ACTIONS = {
  'project.created': 'project',
  'project.updated': 'project',
  'project.status.changed': 'project',
  'project.archived': 'project',
  'project.restored': 'project',
  'member.added': 'members',
  'member.changed': 'members',
  'member.removed': 'members',
  'member.access_ended': 'members',
  'place.created': 'structure',
  'place.updated': 'structure',
  'place.moved': 'structure',
  'place.deactivated': 'structure',
  'place.reactivated': 'structure',
  'place.deleted': 'structure',
  // Sprint 7: project timeline (US-025) and the profile History tab (T-56).
  'workforce.assigned': 'workforce',
  'workforce.assignment_changed': 'workforce',
  'workforce.assignment_ended': 'workforce',
  'workforce.assignment_cancelled': 'workforce',
  'workforce.member.created': 'workforce',
  'workforce.member.updated': 'workforce',
  'workforce.member.status_changed': 'workforce',
  'workforce.member.photo_changed': 'workforce',
  'workforce.member.archived': 'workforce',
  'workforce.member.restored': 'workforce',
  'workforce.member.user_linked': 'workforce',
  'workforce.member.user_unlinked': 'workforce',
  'workforce.record.created': 'workforce',
  'workforce.record.updated': 'workforce',
  'workforce.record.renewed': 'workforce',
  'workforce.record.voided': 'workforce',
  'workforce.contacts.updated': 'workforce',
} as const satisfies Record<string, ActivityGroup>;
export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;

export function activityGroup(action: string): ActivityGroup | undefined {
  return (ACTIVITY_ACTIONS as Record<string, ActivityGroup>)[action];
}

/** Long text values are recorded as "changed" without the text (PLT-18 FR-5). */
export const ACTIVITY_VALUE_MAX = 500;
/** Stored instead of a text longer than ACTIVITY_VALUE_MAX. */
export const ACTIVITY_LONG_VALUE = '__long__';

/** Old and new values of the fields that changed. */
export interface ActivityChanges {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/** Names shown in the sentence, as they were at the time. */
export interface ActivitySnapshot {
  projectCode?: string;
  projectName?: string;
  placeName?: string;
  placeLevel?: string;
  parentName?: string;
  memberName?: string;
  roleCode?: string;
  count?: number;
  // Sprint 7
  positionName?: string | null;
  positionKey?: string | null;
  status?: string;
  recordKind?: string;
  recordType?: string | null;
  recordName?: string | null;
}

export const timelineQuerySchema = z.object({
  type: z.enum(ACTIVITY_GROUPS).optional(),
  before: z
    .string()
    .regex(/^\d+_[0-9a-f-]{36}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface ActivityEntryDto {
  id: string;
  action: ActivityAction;
  group: ActivityGroup;
  actorName: string | null;
  /** The actor has left the company (PLT-18 FR-9). */
  actorFormer: boolean;
  occurredAt: number;
  changes: ActivityChanges | null;
  snapshot: ActivitySnapshot;
}

export interface TimelinePageDto {
  items: ActivityEntryDto[];
  nextBefore: string | null;
}
