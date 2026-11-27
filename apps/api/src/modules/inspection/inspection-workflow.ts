import {
  allItems,
  findingDueOn,
  generateId,
  INSPECTION_LIMITS,
  inspectionReadiness,
  inspectionReference,
  localized,
  scoreInspection,
  type TemplateContent,
} from '@hse/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { ValidationError } from '../../core/errors/app-error';
import type { Statement } from '../../database/unit-of-work';
import { offlineAudit, type OfflineMeta } from '../../platform/sync';
import { type ActionChange, ActionDirectory } from '../action';
import { PermissionResolver } from '../identity';
import { ProjectDirectory, type ProjectRow } from '../project';
import { InspectionContext, type InspectionProject } from './inspection-context';
import {
  FindingOwnerRequiredError,
  InspectionIncompleteError,
  InspectorNotEligibleError,
  TemplateRetiredError,
} from './inspection.errors';
import {
  inspection,
  inspectionFile,
  inspectionFinding,
  type InspectionFindingRow,
  inspectionItemResult,
  type InspectionRow,
  inspectionTemplate,
  type InspectionTemplateRow,
  inspectionTemplateVersion,
} from './inspection.schema';
import type { InspectionService, Loaded } from './inspection.service';
import type { inspectionTransitionRequestSchema } from '@hse/shared';

type TransitionInput = z.output<typeof inspectionTransitionRequestSchema>;
type Choice = { findingId?: string | undefined; itemKey?: string | undefined; decision: 'raise_action' | 'no_action'; reason?: string | null | undefined };

/** Builds the statements of each workflow move (T-78); the service checks who may make it. */
export class InspectionWorkflow {
  constructor(private readonly service: InspectionService) {}

  private get ctx(): InspectionContext {
    return this.service.ctx;
  }

  private statusUpdate(row: InspectionRow, values: Partial<InspectionRow>, by: string, now: Date): Statement[] {
    const version = row.version + 1;
    return [
      this.ctx.db
        .update(inspection)
        .set({ ...values, version, updatedAt: now, updatedBy: by })
        .where(and(eq(inspection.id, row.id), eq(inspection.version, row.version), eq(inspection.status, row.status))),
      this.ctx.db
        .select({
          ok: sql<number>`case when ${inspection.version} = ${version} then 1 else json('inspection changed') end`,
        })
        .from(inspection)
        .where(eq(inspection.id, row.id)),
    ];
  }

  async statements(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    input: TransitionInput,
    offline: OfflineMeta | null,
  ): Promise<Statement[]> {
    const { row, project, template } = loaded;
    const by = principal.userId;
    const nowMs = this.ctx.now();
    const now = new Date(nowMs);
    const record = (
      after: InspectionRow,
      details: Parameters<InspectionContext['record']>[4],
      offset = 0,
    ) => this.ctx.record(by, after, project, template, { ...details, at: nowMs + offset });

    switch (input.to) {
      case 'start': {
        const capturedAt = new Date(offline?.capturedAt ?? nowMs);
        let versionId = row.templateVersionId;
        const current = await this.ctx.db
          .select()
          .from(inspectionTemplate)
          .where(eq(inspectionTemplate.id, row.templateId))
          .get();
        if (current?.status === 'retired' && !offline) throw new TemplateRetiredError();
        // O-147: the version current at start is pinned (an offline start keeps the planned one).
        if (!offline && current?.currentVersionId) versionId = current.currentVersionId;
        const values: Partial<InspectionRow> = {
          status: 'in_progress',
          startedAt: capturedAt,
          templateVersionId: versionId,
          inspectedOn: row.inspectedOn ?? this.ctx.today(tenant),
        };
        const after = { ...row, ...values };
        return [
          ...this.statusUpdate(row, values, by, now),
          ...record(after, {
            audit: 'inspection.started',
            activity: 'inspection.started',
            changes: { before: { status: row.status }, after: { status: 'in_progress' } },
            newValue: offlineAudit(offline),
          }),
        ];
      }
      case 'reassign': {
        if (input.inspectorId === row.inspectorId) return [];
        const allowed = (await this.ctx.projectPermissions(input.inspectorId, tenant.id, project.id)).has(
          'projects.inspections.conduct',
        );
        if (!allowed) throw new InspectorNotEligibleError();
        const values: Partial<InspectionRow> = { inspectorId: input.inspectorId };
        const after = { ...row, ...values };
        return [
          ...this.statusUpdate(row, values, by, now),
          ...record(after, {
            audit: 'inspection.reassigned',
            activity: 'inspection.reassigned',
            oldValue: { inspectorId: row.inspectorId },
            newValue: { inspectorId: input.inspectorId },
          }),
          ...(await this.ctx.notify('inspection.assigned', after, project, template, by, [input.inspectorId])),
          ...(await this.ctx.notify('inspection.unassigned', after, project, template, by, [row.inspectorId])),
        ];
      }
      case 'cancel': {
        const values: Partial<InspectionRow> = {
          cancelledAt: now,
          cancelledBy: by,
          cancelReason: input.reason,
        };
        const after = { ...row, ...values };
        return [
          ...this.statusUpdate(row, values, by, now),
          ...record(after, {
            audit: 'inspection.cancelled',
            activity: 'inspection.cancelled',
            newValue: { reason: input.reason },
            snapshot: { reason: input.reason.slice(0, 200) },
          }),
          ...(await this.ctx.notify('inspection.cancelled', after, project, template, by, [row.inspectorId], {
            reason: input.reason.slice(0, 120),
          })),
        ];
      }
      case 'submit':
        return this.submit(tenant, loaded, principal, input.findingChoices ?? [], offline);
      case 'withdraw': {
        const values: Partial<InspectionRow> = { status: 'in_progress' };
        const after = { ...row, ...values };
        return [
          ...this.statusUpdate(row, values, by, now),
          this.ctx.db.delete(inspectionFinding).where(eq(inspectionFinding.inspectionId, row.id)),
          ...record(after, {
            audit: 'inspection.withdrawn',
            activity: 'inspection.withdrawn',
            changes: { before: { status: 'submitted' }, after: { status: 'in_progress' } },
          }),
        ];
      }
      case 'return': {
        const values: Partial<InspectionRow> = {
          status: 'in_progress',
          reviewStartedAt: null,
          reviewStartedBy: null,
        };
        const after = { ...row, ...values };
        return [
          ...this.statusUpdate(row, values, by, now),
          ...record(after, {
            audit: 'inspection.returned',
            activity: 'inspection.returned',
            newValue: { reason: input.reason },
            changes: { before: { status: 'submitted' }, after: { status: 'in_progress' } },
            snapshot: { reason: input.reason.slice(0, 200) },
          }),
          ...(await this.ctx.notify('inspection.returned', after, project, template, by, [row.inspectorId], {
            reason: input.reason.slice(0, 120),
          })),
        ];
      }
      case 'approve': {
        const findings = await this.service.findingRows(row.id);
        return this.approval(tenant, loaded, principal, row, findings, input.findingChoices ?? [], false);
      }
    }
  }

  // ---- Submit (US-036) and findings (US-039) ---------------------------------------------

  private async submit(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    choices: readonly Choice[],
    offline: OfflineMeta | null,
  ): Promise<Statement[]> {
    const { row, project, template, version } = loaded;
    const content = version.content;
    const by = principal.userId;
    const nowMs = this.ctx.now();
    const now = new Date(nowMs);
    const [itemRows, files] = await Promise.all([
      this.ctx.db.select().from(inspectionItemResult).where(eq(inspectionItemResult.inspectionId, row.id)).all(),
      this.ctx.db
        .select()
        .from(inspectionFile)
        .where(and(eq(inspectionFile.inspectionId, row.id), isNull(inspectionFile.removedAt)))
        .all(),
    ]);
    const items = itemRows.map((item) => ({
      itemKey: item.itemKey,
      result: item.result,
      comment: item.comment,
      photoCount: files.filter((f) => f.itemKey === item.itemKey).length,
    }));
    const issues = inspectionReadiness(content, items, row.areaId !== null);
    if (issues.length > 0) throw new InspectionIncompleteError(issues);
    const score = scoreInspection(content, items);
    const submitCount = row.submitCount + 1;

    const { statements: findingStatements, findings } = await this.generateFindings(
      tenant,
      row,
      content,
      itemRows,
      by,
      now,
    );
    const values: Partial<InspectionRow> = {
      status: 'submitted',
      submittedAt: now,
      submitCount,
      scorePercent: score.percent,
      scoreOutcome: score.outcome,
      reviewStartedAt: null,
      reviewStartedBy: null,
    };
    const after: InspectionRow = { ...row, ...values, version: row.version + 1 };
    const statements: Statement[] = [
      ...this.statusUpdate(row, values, by, now),
      this.ctx.db
        .update(inspectionFile)
        .set({ submittedWith: submitCount })
        .where(and(eq(inspectionFile.inspectionId, row.id), isNull(inspectionFile.submittedWith))),
      ...findingStatements,
      ...this.ctx.record(by, after, project, template, {
        audit: 'inspection.submitted',
        activity: 'inspection.submitted',
        newValue: {
          score: score.percent,
          outcome: score.outcome,
          findings: findings.length,
          submitCount,
          ...offlineAudit(offline),
        },
        changes: { before: { status: 'in_progress' }, after: { status: 'submitted' } },
        snapshot: { count: findings.length },
        at: nowMs,
      }),
    ];
    if (content.needsApproval) {
      statements.push(
        ...(await this.ctx.notify(
          'inspection.submitted',
          after,
          project,
          template,
          by,
          await this.reviewers(tenant, project, row),
        )),
      );
      return statements;
    }
    // O-144: "Needs approval" off — submitting approves at once with the inspector's choices.
    statements.push(...(await this.approval(tenant, loaded, principal, after, findings, choices, true)));
    return statements;
  }

  private description(content: TemplateContent, key: string, comment: string | null, language: string): string {
    const item = allItems(content).find((i) => i.key === key);
    const question = localized(item?.question, language);
    const text = comment ? `${question} — ${comment}` : question;
    const clipped = text.slice(0, INSPECTION_LIMITS.findingDescriptionMax);
    return clipped.length >= INSPECTION_LIMITS.findingDescriptionMin ? clipped : `${clipped} (finding)`;
  }

  /** US-039 FR-1 and US-037 FR-4: findings for failed and raised items, matched by item key. */
  private async generateFindings(
    tenant: TenantCompany,
    row: InspectionRow,
    content: TemplateContent,
    itemRows: readonly { itemKey: string; result: string | null; comment: string | null; priority: InspectionFindingRow['severity'] | null; assignedTo: string | null; raiseFinding: boolean }[],
    by: string,
    now: Date,
  ): Promise<{ statements: Statement[]; findings: InspectionFindingRow[] }> {
    const existing = await this.service.findingRows(row.id);
    const byKey = new Map(itemRows.map((i) => [i.itemKey, i]));
    const statements: Statement[] = [];
    const findings: InspectionFindingRow[] = [];
    const inspectedOn = row.inspectedOn ?? this.ctx.today(tenant);
    let seq = 0;
    const raisingKeys = new Set<string>();
    for (const section of content.sections) {
      for (const item of section.items) {
        const result = byKey.get(item.key);
        const raises =
          result?.result === 'fail' || (result?.result === 'observation' && result.raiseFinding);
        if (!result || !raises) continue;
        raisingKeys.add(item.key);
        seq += 1;
        const severity = result.priority ?? item.defaultPriority;
        const fresh = {
          description: this.description(content, item.key, result.comment, tenant.defaultLanguage),
          severity,
          categoryEn: section.title.en ?? null,
          categoryAr: section.title.ar ?? null,
          responsibleId: result.assignedTo,
          dueOn: findingDueOn(inspectedOn, severity),
        };
        const old = existing.find((f) => f.itemKey === item.key);
        if (old) {
          const kept = old.editedAt !== null ? { seq } : { ...fresh, seq };
          statements.push(
            this.ctx.db
              .update(inspectionFinding)
              .set({ ...kept, updatedAt: now, updatedBy: by })
              .where(eq(inspectionFinding.id, old.id)),
          );
          findings.push({ ...old, ...kept });
        } else {
          const created: InspectionFindingRow = {
            id: generateId(),
            companyId: row.companyId,
            projectId: row.projectId,
            inspectionId: row.id,
            itemKey: item.key,
            seq,
            ...fresh,
            status: 'open',
            decision: null,
            noActionReason: null,
            editedBy: null,
            editedAt: null,
            resolvedAt: null,
            createdAt: now,
            createdBy: by,
            updatedAt: now,
            updatedBy: by,
          };
          statements.push(this.ctx.db.insert(inspectionFinding).values(created));
          findings.push(created);
        }
      }
    }
    const stale = existing.filter((f) => !raisingKeys.has(f.itemKey)).map((f) => f.id);
    if (stale.length > 0) {
      // Deleted first: a re-numbered finding may take a stale one's place.
      statements.unshift(this.ctx.db.delete(inspectionFinding).where(inArray(inspectionFinding.id, stale)));
    }
    if (findings.length > 0) {
      statements.push(
        this.ctx.audit.entry({
          action: 'inspection.findings_generated',
          actorUserId: by,
          companyId: row.companyId,
          projectId: row.projectId,
          entityType: 'inspection',
          entityId: row.id,
          newValue: { count: findings.length },
        }),
      );
    }
    return { statements, findings };
  }

  /** O-150: approvers on the project who aren't the inspector; company-wide roles only if none. */
  async reviewers(
    tenant: Pick<TenantCompany, 'id'>,
    project: InspectionProject,
    row: InspectionRow,
  ): Promise<string[]> {
    const onProject: string[] = [];
    for (const entry of await this.ctx.audience.projectRoles(tenant.id, project.id)) {
      if (entry.userId === row.inspectorId) continue;
      if ((await this.ctx.resolver.roleGrants(tenant.id, entry.roleCode)).has('projects.inspections.approve')) {
        onProject.push(entry.userId);
      }
    }
    if (onProject.length > 0) return [...new Set(onProject)];
    const all = await this.ctx.audience.projectPermissionHolders(
      tenant.id,
      project.id,
      'projects.inspections.approve',
      this.ctx.resolver,
    );
    return all.filter((id) => id !== row.inspectorId);
  }

  // ---- Approve (US-038) ------------------------------------------------------------------

  private async approval(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    row: InspectionRow,
    findings: readonly InspectionFindingRow[],
    choices: readonly Choice[],
    onSubmit: boolean,
  ): Promise<Statement[]> {
    const { project, template, version } = loaded;
    const by = principal.userId;
    const nowMs = this.ctx.now();
    const now = new Date(nowMs);
    const today = this.ctx.today(tenant);
    const reference = inspectionReference(project.code, row.number);
    const decided = findings.map((finding) => {
      const choice = choices.find(
        (c) => (c.findingId && c.findingId === finding.id) || (c.itemKey && c.itemKey === finding.itemKey),
      );
      const decision = choice?.decision ?? finding.decision ?? 'raise_action';
      const reason = choice?.reason ?? finding.noActionReason;
      return { finding, decision, reason };
    });
    const missingOwner = decided
      .filter((d) => d.decision === 'raise_action' && !d.finding.responsibleId)
      .map((d) => d.finding.id);
    if (missingOwner.length > 0) throw new FindingOwnerRequiredError(missingOwner);
    const missingReason = decided.filter(
      (d) => d.decision === 'no_action' && (!d.reason || d.reason.length < INSPECTION_LIMITS.reasonMin),
    );
    if (missingReason.length > 0) {
      throw new ValidationError(
        missingReason.map((d) => ({ path: `findings.${d.finding.id}.reason`, message: 'required' })),
      );
    }

    const statements: Statement[] = [];
    const raising = decided.filter((d) => d.decision === 'raise_action');
    if (raising.length > 0) {
      const engine = this.service.actionEngine();
      const base = await engine.peekNumber(project.id);
      for (const [index, entry] of raising.entries()) {
        const { finding } = entry;
        const prepared = await engine.prepare(
          {
            tenant,
            project: { id: project.id, code: project.code, status: project.status as ProjectRow['status'] },
            source: {
              module: 'inspection',
              recordId: finding.id,
              label: `${reference} · Finding ${String(finding.seq)}`,
            },
            type: 'corrective',
            priority: finding.severity,
            title: this.service.actionTitle(version.content, finding).slice(0, 150),
            description: finding.description,
            ownerId: finding.responsibleId ?? '',
            dueOn: finding.dueOn < today ? today : finding.dueOn,
            place: { areaId: row.areaId, locationId: row.locationId, workZoneId: row.workZoneId },
            createdBy: by,
          },
          base + index,
        );
        statements.push(
          ...prepared.statements,
          this.ctx.db
            .update(inspectionFinding)
            .set({ status: 'action_raised', decision: 'raise_action', updatedAt: now, updatedBy: by })
            .where(eq(inspectionFinding.id, finding.id)),
          this.ctx.audit.entry({
            action: 'inspection.finding_action_raised',
            actorUserId: by,
            companyId: row.companyId,
            projectId: row.projectId,
            entityType: 'inspection',
            entityId: row.id,
            newValue: { findingId: finding.id, action: prepared.reference },
          }),
        );
      }
    }
    for (const entry of decided.filter((d) => d.decision === 'no_action')) {
      statements.push(
        this.ctx.db
          .update(inspectionFinding)
          .set({
            status: 'no_action',
            decision: 'no_action',
            noActionReason: entry.reason ?? null,
            updatedAt: now,
            updatedBy: by,
          })
          .where(eq(inspectionFinding.id, entry.finding.id)),
      );
    }
    const closes = raising.length === 0;
    const approvedValues: Partial<InspectionRow> = {
      status: 'approved',
      approvedAt: now,
      approvedBy: by,
      approvedOnSubmit: onSubmit,
    };
    const approved: InspectionRow = { ...row, ...approvedValues };
    if (onSubmit) {
      // The submit's own update already moved the version; approve on the submitted row.
      statements.push(
        this.ctx.db
          .update(inspection)
          .set({ ...approvedValues, ...(closes ? { status: 'closed', closedAt: now } : {}) })
          .where(and(eq(inspection.id, row.id), eq(inspection.status, 'submitted'))),
      );
    } else {
      statements.push(
        ...this.statusUpdate(
          row,
          { ...approvedValues, ...(closes ? { status: 'closed', closedAt: now } : {}) },
          by,
          now,
        ),
      );
    }
    statements.push(
      ...this.ctx.record(by, approved, project, template, {
        audit: 'inspection.approved',
        activity: 'inspection.approved',
        newValue: {
          raised: raising.length,
          noAction: decided.length - raising.length,
          onSubmit,
        },
        changes: { before: { status: 'submitted' }, after: { status: 'approved' } },
        snapshot: { count: raising.length },
        at: nowMs + 1,
      }),
      ...(await this.ctx.notify('inspection.approved', approved, project, template, by, [row.inspectorId])),
    );
    if (closes) {
      const closed = { ...approved, status: 'closed' as const, closedAt: now };
      statements.push(
        ...this.ctx.record(by, closed, project, template, {
          audit: 'inspection.closed',
          activity: 'inspection.closed',
          changes: { before: { status: 'approved' }, after: { status: 'closed' } },
          at: nowMs + 2,
        }),
        ...(await this.ctx.notify('inspection.closed', closed, project, template, by, [row.inspectorId, by])),
      );
    }
    return statements;
  }

  // ---- Closing (O-138) -------------------------------------------------------------------

  /** Closes an approved inspection when every finding is resolved or needs no action. */
  async closeIfResolved(
    row: InspectionRow,
    project: InspectionProject,
    template: InspectionTemplateRow | null,
    overrides: readonly InspectionFindingRow[],
    actorUserId: string,
    at: number,
  ): Promise<Statement[]> {
    if (row.status !== 'approved' || row.cancelledAt !== null) return [];
    const findings = await this.service.findingRows(row.id);
    const merged = findings.map((f) => overrides.find((o) => o.id === f.id) ?? f);
    if (!merged.every((f) => f.status === 'resolved' || f.status === 'no_action')) return [];
    const now = new Date(at);
    const closed: InspectionRow = { ...row, status: 'closed', closedAt: now };
    return [
      this.ctx.db
        .update(inspection)
        .set({ status: 'closed', closedAt: now, version: row.version + 1, updatedAt: now })
        .where(and(eq(inspection.id, row.id), eq(inspection.status, 'approved'))),
      ...this.ctx.record(actorUserId, closed, project, template, {
        audit: 'inspection.closed',
        activity: 'inspection.closed',
        changes: { before: { status: 'approved' }, after: { status: 'closed' } },
        at,
      }),
      ...(await this.ctx.notify(
        'inspection.closed',
        closed,
        project,
        template,
        actorUserId,
        [row.inspectorId, ...(row.approvedBy ? [row.approvedBy] : [])],
      )),
    ];
  }
}

/**
 * T-79: the action engine calls this inside its batch when an action raised from a finding is
 * closed or voided. The finding resolves (or opens again) and the inspection may close.
 */
export async function onFindingActionChanged(input: ActionChange): Promise<Statement[]> {
  const { db, companyId, recordId } = input;
  const finding = await db
    .select()
    .from(inspectionFinding)
    .where(and(eq(inspectionFinding.companyId, companyId), eq(inspectionFinding.id, recordId)))
    .get();
  if (!finding) return [];
  const row = await db.select().from(inspection).where(eq(inspection.id, finding.inspectionId)).get();
  if (!row) return [];
  const facts = await new ProjectDirectory(db).get(companyId, row.projectId);
  if (!facts) return [];
  const resolver = new PermissionResolver(db, () => input.now);
  const actions = await new ActionDirectory(db, resolver).actionsForSource(companyId, 'inspection', [finding.id]);
  const merged = actions.map((a) =>
    a.id === input.action.id
      ? { ...a, status: input.action.status as typeof a.status, voided: input.action.voided }
      : a,
  );
  const active = merged.filter((a) => !a.voided);
  const status: InspectionFindingRow['status'] =
    active.length === 0 ? 'open' : active.every((a) => a.status === 'closed') ? 'resolved' : 'action_raised';
  if (status === finding.status) return [];
  const { InspectionService } = await import('./inspection.service');
  const ctx = new InspectionContext({ db, meta: input.meta, clock: () => input.now, resolver });
  const service = new InspectionService(ctx);
  const workflow = new InspectionWorkflow(service);
  const template = (await db.select().from(inspectionTemplate).where(eq(inspectionTemplate.id, row.templateId)).get()) ?? null;
  const project: InspectionProject = { id: facts.id, code: facts.code, status: facts.status };
  const now = new Date(input.now);
  const updated: InspectionFindingRow = {
    ...finding,
    status,
    resolvedAt: status === 'resolved' ? now : null,
  };
  const reference = `${facts.code}-ACT-${String(input.action.number).padStart(4, '0')}`;
  return [
    db
      .update(inspectionFinding)
      .set({ status, resolvedAt: updated.resolvedAt, updatedAt: now, updatedBy: input.actorUserId })
      .where(eq(inspectionFinding.id, finding.id)),
    ...ctx.record(input.actorUserId, row, project, template, {
      audit: status === 'resolved' ? 'inspection.finding_resolved' : 'inspection.finding_reopened',
      activity: status === 'resolved' ? 'inspection.finding_resolved' : 'inspection.finding_reopened',
      newValue: { findingId: finding.id, action: reference, status },
      snapshot: { findingSeq: finding.seq, actionReference: reference },
      at: input.now + 10,
    }),
    ...(status === 'resolved'
      ? await workflow.closeIfResolved(row, project, template, [updated], input.actorUserId, input.now + 11)
      : []),
  ];
}

export { inspectionTemplateVersion };
