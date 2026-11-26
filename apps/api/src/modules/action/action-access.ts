import {
  type ActionActorFacts,
  type ActionCanDto,
  allowedTransitions,
  type ActionTransition,
  isActionActive,
} from '@hse/shared';

import type { Database } from '../../database/client';
import type { Principal } from '../../core/auth/principal';
import { actionSource } from './action-sources';
import type { ActionRow } from './action.schema';

/** The caller on one project: their project-scope permissions there (T-32: read per request). */
export interface ActionViewer {
  userId: string;
  granted: ReadonlySet<string>;
  /** The project is archived: everything is read-only (O-53, O-111). */
  archived: boolean;
}

export function viewAll(viewer: ActionViewer): boolean {
  return viewer.granted.has('projects.actions.view');
}

export interface ActionRelation {
  owner: boolean;
  collaborator: boolean;
  creator: boolean;
}

export function relationOf(
  viewer: ActionViewer,
  row: ActionRow,
  collaboratorIds: readonly string[],
): ActionRelation {
  return {
    owner: row.ownerId === viewer.userId,
    collaborator: collaboratorIds.includes(viewer.userId),
    creator: row.createdBy === viewer.userId,
  };
}

/** T-65: all actions with `projects.actions.view`; otherwise the participant's own. */
export async function mayView(
  db: Database,
  principal: Principal,
  viewer: ActionViewer,
  row: ActionRow,
  collaboratorIds: readonly string[],
): Promise<boolean> {
  if (!viewer.granted.has('projects.view')) return false;
  const relation = relationOf(viewer, row, collaboratorIds);
  if (!viewAll(viewer) && !relation.owner && !relation.collaborator && !relation.creator) {
    return false;
  }
  const source = actionSource(row.sourceModule);
  if (source?.canView && row.sourceRecordId) {
    return source.canView(db, principal, row.sourceRecordId);
  }
  return true;
}

export function factsOf(
  viewer: ActionViewer,
  row: ActionRow,
  collaboratorIds: readonly string[],
): ActionActorFacts {
  const relation = relationOf(viewer, row, collaboratorIds);
  return {
    owner: relation.owner,
    participant: relation.owner || relation.collaborator,
    verify: viewer.granted.has('projects.actions.verify'),
    close: viewer.granted.has('projects.actions.close'),
  };
}

export function locked(row: ActionRow): boolean {
  return row.status === 'closed' || row.voidedAt !== null;
}

/** The moves the caller may make now; none on locked actions or archived projects. */
export function transitionsFor(
  viewer: ActionViewer,
  row: ActionRow,
  collaboratorIds: readonly string[],
): ActionTransition[] {
  if (viewer.archived || locked(row)) return [];
  return allowedTransitions(row.status, factsOf(viewer, row, collaboratorIds));
}

export function canOf(
  viewer: ActionViewer,
  row: ActionRow,
  collaboratorIds: readonly string[],
  acceptsRecords: boolean,
): ActionCanDto {
  const relation = relationOf(viewer, row, collaboratorIds);
  const facts = factsOf(viewer, row, collaboratorIds);
  const writable = !viewer.archived && !locked(row);
  const active = writable && isActionActive(row.status);
  const manage = viewer.granted.has('projects.actions.manage');
  const verifier = facts.verify && !facts.participant;
  return {
    edit: active && manage,
    reassign: active && manage,
    manageCollaborators: active && (manage || relation.owner),
    void: active && manage,
    addProgress: active && facts.participant,
    addFiles:
      (active && facts.participant) || (writable && row.status === 'completed' && verifier),
    comment: writable && viewer.granted.has('projects.view'),
    followUp:
      !viewer.archived &&
      acceptsRecords &&
      row.status === 'closed' &&
      row.voidedAt === null &&
      viewer.granted.has('projects.actions.create'),
    verifyBlockedAsParticipant: facts.verify && facts.participant && row.status === 'completed',
  };
}
