import {
  acceptsRecords,
  ACTION_LIMITS,
  type ActionPriority,
  actionReference,
  type ActionType,
  addIsoDays,
  generateId,
  normalizeSearchText,
  type NotificationParams,
  type PlaceSelection,
  type ProjectStatus,
} from '@hse/shared';

import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { ProjectArchivedError, withRecordNumber } from '../project';
import type { ActionContext } from './action-context';
import { actionSource, MANUAL_SOURCE_LABEL } from './action-sources';
import {
  CollaboratorLimitError,
  DueDateInvalidError,
  OwnerNotEligibleError,
  ProjectNotAcceptingRecordsError,
} from './action.errors';
import type { ActionRow } from './action.schema';

/** The project an action belongs to, as the caller loaded it. */
export interface ActionProject {
  id: string;
  code: string;
  status: ProjectStatus;
}

/** `ActionEngine.prepare` input (PLT-23 § Sources). */
export interface NewAction {
  tenant: TenantCompany;
  project: ActionProject;
  /** `label`: a registered source may give its label itself (its record is in the same batch). */
  source: { module: string; recordId?: string | null; label?: string };
  type: ActionType;
  priority: ActionPriority;
  title: string;
  description?: string | null;
  ownerId: string;
  dueOn: string;
  place?: PlaceSelection | null;
  collaboratorIds?: readonly string[];
  createdBy: string;
}

export interface PreparedAction {
  row: ActionRow;
  reference: string;
  statements: Statement[];
}

/** SQLite's message for a number taken by another request (T-60). */
export const ACTION_NUMBER_INDEX = 'action.project_id, action.number';

/**
 * The one way to create actions (T-57), for this module and for source modules. `prepare`
 * checks every US-053 rule and returns the statements for the caller's `UnitOfWork`; run the
 * whole change inside `withActionNumber` so a number taken by a concurrent request is retried.
 */
export class ActionEngine {
  constructor(private readonly ctx: ActionContext) {}

  /** `number`: several actions in one batch take consecutive numbers after one `peekNumber`. */
  async prepare(input: NewAction, number?: number): Promise<PreparedAction> {
    const { tenant, project } = input;
    if (project.status === 'archived') throw new ProjectArchivedError();
    if (!acceptsRecords(project.status)) throw new ProjectNotAcceptingRecordsError(project.status);

    const today = this.ctx.today(tenant);
    if (input.dueOn < today || input.dueOn > addIsoDays(today, ACTION_LIMITS.dueDaysMax)) {
      throw new DueDateInvalidError();
    }
    if (!(await this.ctx.eligible(tenant.id, project.id, input.ownerId))) {
      throw new OwnerNotEligibleError();
    }
    const collaborators = [...new Set(input.collaboratorIds ?? [])].filter(
      (id) => id !== input.ownerId,
    );
    if (collaborators.length > ACTION_LIMITS.collaboratorsMax) {
      throw new CollaboratorLimitError(ACTION_LIMITS.collaboratorsMax);
    }
    for (const userId of collaborators) {
      if (!(await this.ctx.eligible(tenant.id, project.id, userId))) {
        throw new OwnerNotEligibleError();
      }
    }

    const place = input.place ?? {};
    const issues = await this.ctx.places.validateSelection(tenant.id, project.id, place);
    if (issues.length > 0) {
      throw new ValidationError(issues.map((issue) => ({ ...issue, path: `place.${issue.path}` })));
    }

    const label = await this.sourceLabel(tenant, project, input.source);
    const assigned = number ?? (await this.ctx.numbers.peek(project.id, 'action'));
    const now = new Date(this.ctx.now());
    const row: ActionRow = {
      id: generateId(),
      companyId: tenant.id,
      projectId: project.id,
      number: assigned,
      sourceModule: input.source.module,
      sourceRecordId: input.source.recordId ?? null,
      sourceLabel: label,
      type: input.type,
      priority: input.priority,
      status: 'open',
      title: input.title,
      searchKey: normalizeSearchText(input.title),
      description: input.description ?? null,
      ownerId: input.ownerId,
      dueOn: input.dueOn,
      areaId: place.areaId ?? null,
      locationId: place.locationId ?? null,
      workZoneId: place.workZoneId ?? null,
      progressPercent: null,
      startedAt: null,
      completedAt: null,
      completedOnTime: null,
      verifiedAt: null,
      verifiedBy: null,
      verificationMethod: null,
      closedAt: null,
      closedBy: null,
      sendBackCount: 0,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      createdAt: now,
      createdBy: input.createdBy,
      updatedAt: now,
      updatedBy: input.createdBy,
    };
    const reference = actionReference(project.code, assigned);
    const params: NotificationParams = {
      projectCode: project.code,
      actionReference: reference,
      actionTitle: row.title.slice(0, 80),
      priority: row.priority,
      dueOn: row.dueOn,
    };
    const notify = (type: 'action.assigned' | 'action.collaborator_added', recipients: string[]) =>
      this.ctx.notifications.entries({
        type,
        companyId: tenant.id,
        projectId: project.id,
        entityType: 'action',
        entityId: row.id,
        actorUserId: input.createdBy,
        params,
        recipients,
      });

    const statements: Statement[] = [
      this.ctx.numbers.claim(project.id, 'action', assigned),
      this.ctx.repo.insert(row),
      this.ctx.repo.openOwnerHistory({
        id: generateId(),
        actionId: row.id,
        ownerId: row.ownerId,
        fromAt: now,
        assignedBy: input.createdBy,
        reason: null,
      }),
      ...collaborators.map((userId) =>
        this.ctx.repo.addCollaborator({
          id: generateId(),
          actionId: row.id,
          userId,
          addedAt: now,
          addedBy: input.createdBy,
          removedAt: null,
          removedBy: null,
        }),
      ),
      ...this.ctx.record(input.createdBy, row, project.code, {
        audit: 'action.created',
        activity: 'action.created',
        newValue: {
          reference,
          source: row.sourceModule,
          sourceRecordId: row.sourceRecordId,
          type: row.type,
          priority: row.priority,
          ownerId: row.ownerId,
          dueOn: row.dueOn,
          collaborators,
        },
      }),
      ...notify('action.assigned', [row.ownerId]),
      ...notify('action.collaborator_added', collaborators),
    ];
    return { row, reference, statements };
  }

  /** The next free number of the project (for several actions in one batch). */
  peekNumber(projectId: string): Promise<number> {
    return this.ctx.numbers.peek(projectId, 'action');
  }

  /** Creates one action on its own (US-053), retrying a number taken concurrently. */
  create(input: NewAction): Promise<PreparedAction> {
    return withActionNumber(async () => {
      const prepared = await this.prepare(input);
      await new UnitOfWork(this.ctx.db).add(...prepared.statements).commit();
      return prepared;
    });
  }

  private async sourceLabel(
    tenant: TenantCompany,
    project: ActionProject,
    source: NewAction['source'],
  ): Promise<string> {
    if (source.module === 'manual') return MANUAL_SOURCE_LABEL;
    if (!source.recordId) throw new ValidationError([{ path: 'source', message: 'required' }]);
    if (source.module === 'action') {
      const closed = await this.ctx.repo.find(tenant.id, project.id, source.recordId);
      if (closed?.status !== 'closed' || closed.voidedAt !== null) {
        throw new ValidationError([{ path: 'followUpOf', message: 'actionNotClosed' }]);
      }
      return actionReference(project.code, closed.number);
    }
    const registered = actionSource(source.module);
    if (!registered) throw new NotFoundError();
    if (source.label) return source.label;
    const described = await registered.describe(this.ctx.db, tenant.id, source.recordId);
    if (described?.projectId !== project.id) throw new NotFoundError();
    return described.label;
  }
}

/** Retries `attempt` when another request took the action number first (T-60). */
export function withActionNumber<T>(attempt: () => Promise<T>): Promise<T> {
  return withRecordNumber(ACTION_NUMBER_INDEX, attempt);
}
