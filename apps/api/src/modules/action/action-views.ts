import {
  actionDueState,
  type ActionFileDto,
  type ActionListItemDto,
  type ActionPersonDto,
  type ActionPlaceDto,
  actionReference,
  type ActionUpdateDto,
  daysBetween,
} from '@hse/shared';

import type { ResolvedPlace } from '../project';
import type { ActionFileView } from './action.repository';
import type { ActionRow, ActionUpdateRow } from './action.schema';

/** Names and access of the people shown on actions. */
export interface PeopleIndex {
  names: ReadonlyMap<string, string>;
  /** O-101: per user id, can they view the project now. Missing = unknown (treated as true). */
  access: ReadonlyMap<string, boolean>;
}

export function person(people: PeopleIndex, userId: string): ActionPersonDto {
  return {
    id: userId,
    name: people.names.get(userId) ?? '',
    hasAccess: people.access.get(userId) ?? true,
  };
}

/** The deepest place of a record (work zone, else location, else area). */
export function deepestPlaceId(row: ActionRow): string | null {
  return row.workZoneId ?? row.locationId ?? row.areaId;
}

export function placeOf(
  row: ActionRow,
  places: ReadonlyMap<string, ResolvedPlace>,
): ActionPlaceDto | null {
  const placeId = deepestPlaceId(row);
  if (!placeId) return null;
  const resolved = places.get(placeId);
  return {
    areaId: row.areaId,
    locationId: row.locationId,
    workZoneId: row.workZoneId,
    placeId,
    names: resolved?.names ?? [],
    active: resolved?.active ?? false,
  };
}

export function toListItem(
  row: ActionRow,
  context: {
    projectCode: string;
    today: string;
    people: PeopleIndex;
    places: ReadonlyMap<string, ResolvedPlace>;
  },
): ActionListItemDto {
  const dueState = actionDueState(row.dueOn, row.status, context.today);
  return {
    id: row.id,
    projectId: row.projectId,
    projectCode: context.projectCode,
    reference: actionReference(context.projectCode, row.number),
    title: row.title,
    type: row.type,
    priority: row.priority,
    status: row.status,
    dueOn: row.dueOn,
    dueState,
    daysOverdue: dueState === 'overdue' ? daysBetween(row.dueOn, context.today) : 0,
    owner: person(context.people, row.ownerId),
    place: placeOf(row, context.places),
    source: {
      module: row.sourceModule,
      recordId: row.sourceRecordId,
      label: row.sourceLabel,
      href: row.sourceModule === 'action' && row.sourceRecordId ? row.sourceRecordId : null,
    },
    progressPercent: row.progressPercent,
    voided: row.voidedAt !== null,
    updatedAt: row.updatedAt.getTime(),
  };
}

export function toUpdate(row: ActionUpdateRow, people: PeopleIndex): ActionUpdateDto {
  return {
    id: row.id,
    kind: row.kind,
    note: row.note,
    percent: row.percent,
    method: row.method,
    by: person(people, row.createdBy),
    at: row.createdAt.getTime(),
    fileIds: parseIds(row.fileIds),
  };
}

export function toFile(row: ActionFileView, updates: readonly ActionUpdateRow[]): ActionFileDto {
  const first = [...updates].reverse().find((update) => parseIds(update.fileIds).includes(row.fileId));
  return {
    id: row.fileId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    updateId: first?.id ?? null,
    addedBy: row.addedBy,
    addedAt: row.addedAt.getTime(),
  };
}

export function parseIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
