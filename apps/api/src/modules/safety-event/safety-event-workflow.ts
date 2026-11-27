import {
  addIsoDays,
  type addendumActionRequestSchema,
  type causesRequestSchema,
  type classifySafetyEventRequestSchema,
  generateId,
  INVESTIGATION_DUE_DAYS,
  investigationRequired,
  type investigationRequestSchema,
  type ProjectStatus,
  type raiseRecommendationActionRequestSchema,
  rateRisk,
  type RecommendationKind,
  type recommendationRequestSchema,
  SAFETY_EVENT_LIMITS,
  type SafetyActionInput,
  type SafetyEventDto,
  type safetyEventTransitionRequestSchema,
  safetyEventReference,
  safetyEventStep,
  type SafetySeverity,
  severityAtLeast,
  severityRank,
} from "@hse/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Principal } from "../../core/auth/principal";
import type { IdempotencyClaim } from "../../core/context/app-context";
import type { TenantCompany } from "../../core/context/tenant";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../core/errors/app-error";
import type { Statement } from "../../database/unit-of-work";
import { UnitOfWork } from "../../database/unit-of-work";
import type { ActionChange } from "../action";
import {
  ActionContext,
  ActionDirectory,
  ActionEngine,
  withActionNumber,
} from "../action";
import { PermissionResolver } from "../identity";
import { ProjectArchivedError, ProjectDirectory } from "../project";
import { RiskMatrixDirectory } from "../risk";
import {
  SafetyEventContext,
  type SafetyEventProject,
} from "./safety-event-context";
import {
  InvestigationChangedError,
  InvestigationIncompleteError,
  InvestigationRequiredError,
  InvestigatorNotEligibleError,
  OpenActionsError,
  RecommendationLockedError,
  RiskRatingRequiredError,
  SafetyEventLockedError,
  SafetyEventTransitionError,
  SelfClosureError,
  SeverityBelowMinimumError,
} from "./safety-event.errors";
import {
  safetyEvent,
  safetyEventCategoryLink,
  safetyEventCause,
  safetyEventInvestigation,
  safetyEventInvestigationMember,
  safetyEventRecommendation,
  type SafetyEventRecommendationRow,
  type SafetyEventRow,
  safetyEventType,
  type SafetyEventTypeRow,
  safetyListItem,
} from "./safety-event.schema";
import { type Loaded, SafetyEventService } from "./safety-event.service";

type ClassifyInput = z.output<typeof classifySafetyEventRequestSchema>;
type TransitionInput = z.output<typeof safetyEventTransitionRequestSchema>;
type InvestigationInput = z.output<typeof investigationRequestSchema>;
type CausesInput = z.output<typeof causesRequestSchema>;
type RecommendationInput = z.output<typeof recommendationRequestSchema>;
type RaiseInput = z.output<typeof raiseRecommendationActionRequestSchema>;
type AddendumInput = z.output<typeof addendumActionRequestSchema>;

const ACTION_TYPE: Record<
  RecommendationKind,
  "corrective" | "preventive" | "improvement"
> = {
  immediate: "corrective",
  corrective: "corrective",
  preventive: "preventive",
  improvement: "improvement",
};

/** US-043 – US-046: review, transitions, investigation, recommendations and actions (T-86, T-89). */
export class SafetyEventWorkflow {
  constructor(readonly service: SafetyEventService) {}

  private get ctx(): SafetyEventContext {
    return this.service.ctx;
  }

  private actionEngine(): ActionEngine {
    if (!this.ctx.deps.bucket)
      throw new Error("Actions need the full request context");
    return new ActionEngine(
      new ActionContext({
        db: this.ctx.db,
        meta: this.ctx.deps.meta,
        clock: this.ctx.deps.clock,
        bucket: this.ctx.deps.bucket,
        resolver: this.ctx.resolver,
      }),
    );
  }

  private assertOpen(loaded: Loaded): void {
    if (loaded.access.archived) throw new ProjectArchivedError();
    if (loaded.row.voidedAt !== null || loaded.row.status === "closed")
      throw new SafetyEventLockedError();
  }

  private async canInvestigate(
    companyId: string,
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const granted = await this.ctx.projectPermissions(
      userId,
      companyId,
      projectId,
    );
    return (
      granted.has("projects.safety_events.investigate") &&
      granted.has("projects.view")
    );
  }

  /** Only one `.manage` holder on the project (company-wide roles excluded) may review their own report. */
  private async selfReviewAllowed(loaded: Loaded): Promise<boolean> {
    const others = (
      await this.service.reviewers(
        loaded.row.companyId,
        loaded.row.projectId,
        loaded.row.reportedBy,
      )
    ).filter((id) => id !== loaded.row.reportedBy);
    return others.length === 0;
  }

  private async assertReviewer(loaded: Loaded): Promise<boolean> {
    if (!loaded.access.manage) throw new ForbiddenError();
    if (!loaded.access.reporter) return false;
    if (!(await this.selfReviewAllowed(loaded))) throw new ForbiddenError();
    return true;
  }

  // ---- Review (US-043) -------------------------------------------------------------------

  async reviewStart(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
  ): Promise<void> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertOpen(loaded);
    await this.assertReviewer(loaded);
    const { row } = loaded;
    if (row.status !== "reported" || row.reviewStartedAt !== null) return;
    const now = new Date(this.ctx.now());
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(safetyEvent)
          // No version bump: the reviewer's page holds this version, and reporter edits are
          // refused by the `review_started_at` guard (US-040 FR-4).
          .set({ reviewStartedAt: now, reviewStartedBy: principal.userId })
          .where(
            and(
              eq(safetyEvent.id, row.id),
              eq(safetyEvent.status, "reported"),
              isNull(safetyEvent.reviewStartedAt),
            ),
          ),
        ...this.ctx.record(principal.userId, row, project, loaded.type, {
          audit: "safety_event.review_started",
          activity: "safety_event.review_started",
        }),
      )
      .commit();
  }

  /** The classification as statements; also used by the decision transitions. */
  private async classification(
    tenant: TenantCompany,
    loaded: Loaded,
    input: ClassifyInput,
  ): Promise<{
    next: Partial<SafetyEventRow>;
    type: SafetyEventTypeRow;
    statements: Statement[];
    changed: string[];
  }> {
    const { row } = loaded;
    let type = loaded.type;
    const next: Partial<SafetyEventRow> = {};
    const statements: Statement[] = [];
    if (input.typeId !== undefined && input.typeId !== row.typeId) {
      type = await this.service.reportType(tenant.id, input.typeId, null);
      next.typeId = type.id;
      next.family = type.family;
    }
    if (input.categoryIds !== undefined) {
      const current = await this.service.categoryIds(row.id);
      await this.service.assertCategories(
        tenant.id,
        input.categoryIds,
        current,
      );
      statements.push(
        this.ctx.db
          .delete(safetyEventCategoryLink)
          .where(eq(safetyEventCategoryLink.eventId, row.id)),
      );
      for (const categoryId of new Set(input.categoryIds)) {
        statements.push(
          this.ctx.db
            .insert(safetyEventCategoryLink)
            .values({ eventId: row.id, categoryId, companyId: row.companyId }),
        );
      }
    }
    if (input.severity !== undefined) next.severity = input.severity;
    const severity = next.severity ?? row.severity;
    if (severity && !severityAtLeast(severity, type.minSeverity)) {
      throw new SeverityBelowMinimumError(type.minSeverity ?? "low");
    }
    if (input.risk !== undefined) {
      if (input.risk === null) {
        Object.assign(next, {
          riskMatrixVersion: null,
          riskLikelihood: null,
          riskConsequence: null,
          riskScore: null,
          riskBand: null,
          riskBandLabel: null,
        });
      } else {
        const matrix = await new RiskMatrixDirectory(
          this.ctx.db,
          this.ctx.deps.clock,
        ).current(tenant.id);
        const rating = rateRisk(
          matrix,
          input.risk.likelihood,
          input.risk.consequence,
        );
        if (!rating)
          throw new ValidationError([{ path: "risk", message: "invalid" }]);
        Object.assign(next, {
          riskMatrixVersion: matrix.versionNo,
          riskLikelihood: input.risk.likelihood,
          riskConsequence: input.risk.consequence,
          riskScore: rating.score,
          riskBand: rating.band.key,
          riskBandLabel: {
            en: rating.band.label.en,
            ar: rating.band.label.ar ?? null,
          },
        });
      }
    }
    if (input.place !== undefined) {
      Object.assign(
        next,
        await this.service.placeFields(
          tenant,
          row.projectId,
          input.place,
          type.areaRequired,
          [row.areaId, row.locationId, row.workZoneId].filter(
            (v): v is string => v !== null,
          ),
        ),
      );
    }
    if (input.reviewNote !== undefined) next.reviewNote = input.reviewNote;
    next.investigationRequired = investigationRequired(
      type.investigation,
      severity,
    );
    return { next, type, statements, changed: Object.keys(next) };
  }

  /** Classification complete (US-043): categories, confirmed severity, rating where required. */
  private async assertClassified(
    row: SafetyEventRow,
    type: SafetyEventTypeRow,
  ): Promise<void> {
    const categories = await this.service.categoryIds(row.id);
    const missing: string[] = [];
    if (categories.length === 0) missing.push("categoryIds");
    if (!row.severity) missing.push("severity");
    if (missing.length > 0)
      throw new ValidationError(
        missing.map((path) => ({ path, message: "required" })),
      );
    if (type.riskRating === "required" && row.riskScore === null)
      throw new RiskRatingRequiredError();
    if (type.areaRequired && !row.areaId)
      throw new ValidationError([{ path: "place", message: "required" }]);
  }

  async classify(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    input: ClassifyInput,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertOpen(loaded);
    const self = await this.assertReviewer(loaded);
    const { row } = loaded;
    if (
      row.status !== "reported" &&
      !(input.severity && Object.keys(input).length <= 2)
    ) {
      // After the review only the severity may still be raised (O-166).
      throw new SafetyEventTransitionError(row.status);
    }
    if (input.baseVersion !== undefined && input.baseVersion !== row.version) {
      throw new SafetyEventTransitionError(row.status);
    }
    if (
      row.status !== "reported" &&
      input.severity &&
      row.severity &&
      severityRank(input.severity) < severityRank(row.severity)
    ) {
      throw new ValidationError([{ path: "severity", message: "onlyRaise" }]);
    }
    const { next, type, statements, changed } = await this.classification(
      tenant,
      loaded,
      input,
    );
    if (
      row.status !== "reported" &&
      next.investigationRequired &&
      !loaded.investigation
    ) {
      // A raised severity on an event already in Corrective Action: it now needs an investigation.
      next.investigationRequired = true;
    }
    const now = new Date(this.ctx.now());
    const version = row.version + 1;
    const after: SafetyEventRow = {
      ...row,
      ...next,
      version,
      updatedAt: now,
      updatedBy: principal.userId,
    };
    const before = Object.fromEntries(
      changed.map((k) => [k, row[k as keyof SafetyEventRow]]),
    );
    const all: Statement[] = [
      this.ctx.db
        .update(safetyEvent)
        .set({
          ...next,
          ...(row.reviewStartedAt
            ? {}
            : { reviewStartedAt: now, reviewStartedBy: principal.userId }),
          selfReviewed: self || row.selfReviewed,
          version,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(
          and(eq(safetyEvent.id, row.id), eq(safetyEvent.version, row.version)),
        ),
      this.service.guard(row.id, version, now, principal.userId),
      ...statements,
      ...this.ctx.record(principal.userId, after, project, type, {
        audit: "safety_event.classified",
        activity: "safety_event.classified",
        oldValue: before,
        newValue: {
          ...next,
          ...(input.categoryIds ? { categoryIds: input.categoryIds } : {}),
        },
        changes: { before, after: next },
        snapshot: { severity: after.severity },
      }),
    ];
    if (
      next.severity &&
      next.severity !== (row.severity ?? row.reportedSeverity)
    ) {
      all.push(
        ...(await this.service.severityNotifications(
          tenant,
          after,
          project,
          type,
          row.severity ?? row.reportedSeverity,
          next.severity,
          principal.userId,
        )),
      );
    }
    await this.service.commitGuarded(row, all);
    return this.service.detail(tenant, project, principal, id);
  }

  // ---- Transitions (T-86) ------------------------------------------------------------------

  async transition(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    input: TransitionInput,
    claim: IdempotencyClaim | undefined,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertOpen(loaded);
    const { row, access } = loaded;
    const step = safetyEventStep(input.to);
    if (!step.from.includes(row.status))
      throw new SafetyEventTransitionError(row.status);
    switch (step.actor) {
      case "manager":
        if (!access.manage) throw new ForbiddenError();
        break;
      case "lead":
        if (!access.lead) throw new ForbiddenError();
        break;
      case "closer":
        if (!access.close) throw new ForbiddenError();
        break;
    }
    let statements: Statement[];
    await withActionNumber(async () => {
      switch (input.to) {
        case "assign":
          statements = await this.assign(tenant, loaded, principal, input);
          break;
        case "act":
          statements = await this.act(tenant, loaded, principal, input.actions);
          break;
        case "close":
          statements = await this.close(loaded, principal, input);
          break;
        case "reassign":
          statements = await this.reassign(tenant, loaded, principal, input);
          break;
        case "complete_investigation":
          statements = await this.complete(tenant, loaded, principal);
          break;
        case "return":
          statements = await this.returnInvestigation(
            loaded,
            principal,
            input.reason,
          );
          break;
        case "void":
          statements = await this.void(tenant, loaded, principal, input);
          break;
      }
      if (claim) {
        statements.push(
          this.ctx.keys.record(claim, {
            companyId: row.companyId,
            userId: principal.userId,
            resourceType: "safety_event",
            resourceId: row.id,
            statusCode: 200,
          }),
        );
      }
      await this.service.commitGuarded(row, statements);
    });
    return this.service.detail(tenant, project, principal, id);
  }

  /** The status change, guarded on status and version; History entry with the reason. */
  private move(
    loaded: Loaded,
    principal: Principal,
    to: SafetyEventRow["status"],
    extra: Partial<SafetyEventRow>,
    audit: Parameters<SafetyEventContext["record"]>[4]["audit"],
    details: {
      newValue?: Record<string, unknown>;
      snapshot?: Record<string, unknown>;
      at?: number;
    } = {},
  ): { statements: Statement[]; after: SafetyEventRow } {
    const { row } = loaded;
    const now = new Date(details.at ?? this.ctx.now());
    const version = row.version + 1;
    const after: SafetyEventRow = {
      ...row,
      ...extra,
      status: to,
      version,
      updatedAt: now,
      updatedBy: principal.userId,
    };
    return {
      after,
      statements: [
        this.ctx.db
          .update(safetyEvent)
          .set({
            ...extra,
            status: to,
            version,
            updatedAt: now,
            updatedBy: principal.userId,
          })
          .where(
            and(
              eq(safetyEvent.id, row.id),
              eq(safetyEvent.version, row.version),
              eq(safetyEvent.status, row.status),
            ),
          ),
        this.service.guard(row.id, version, now, principal.userId),
        ...this.ctx.record(
          principal.userId,
          after,
          loaded.project,
          loaded.type,
          {
            audit,
            activity: audit as never,
            changes:
              row.status === to
                ? null
                : { before: { status: row.status }, after: { status: to } },
            newValue: details.newValue ?? null,
            snapshot: details.snapshot,
            ...(details.at === undefined ? {} : { at: details.at }),
          },
        ),
      ],
    };
  }

  private async reviewDecisionFields(
    loaded: Loaded,
    principal: Principal,
  ): Promise<Partial<SafetyEventRow>> {
    const self = await this.assertReviewer(loaded);
    const now = new Date(this.ctx.now());
    return {
      reviewedAt: now,
      reviewedBy: principal.userId,
      selfReviewed: self || loaded.row.selfReviewed,
      ...(loaded.row.reviewStartedAt
        ? {}
        : { reviewStartedAt: now, reviewStartedBy: principal.userId }),
    };
  }

  private async assertTeam(
    tenant: TenantCompany,
    loaded: Loaded,
    leadId: string,
    memberIds: readonly string[],
  ): Promise<string[]> {
    const members = [...new Set(memberIds)].filter((m) => m !== leadId);
    if (members.length > SAFETY_EVENT_LIMITS.teamMax)
      throw new ValidationError([{ path: "memberIds", message: "tooMany" }]);
    for (const userId of [leadId, ...members]) {
      if (!(await this.canInvestigate(tenant.id, loaded.row.projectId, userId)))
        throw new InvestigatorNotEligibleError();
    }
    // O-170: the reporter can't lead a required investigation.
    if (loaded.row.investigationRequired && leadId === loaded.row.reportedBy)
      throw new InvestigatorNotEligibleError();
    return members;
  }

  private async assign(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    input: Extract<TransitionInput, { to: "assign" }>,
  ): Promise<Statement[]> {
    const { row } = loaded;
    if (loaded.investigation) throw new SafetyEventTransitionError(row.status);
    await this.assertClassified(row, loaded.type);
    const review = await this.reviewDecisionFields(loaded, principal);
    const members = await this.assertTeam(
      tenant,
      loaded,
      input.leadId,
      input.memberIds,
    );
    const today = this.ctx.today(tenant);
    const severity = (row.severity ?? row.reportedSeverity) as SafetySeverity;
    const dueOn =
      input.dueOn ?? addIsoDays(today, INVESTIGATION_DUE_DAYS[severity]);
    if (dueOn < today)
      throw new ValidationError([{ path: "dueOn", message: "past" }]);
    const now = new Date(this.ctx.now());
    const investigationId = generateId();
    const { statements, after } = this.move(
      loaded,
      principal,
      "under_investigation",
      review,
      "safety_event.investigation_assigned",
      {
        newValue: { leadId: input.leadId, members, dueOn },
        snapshot: { dueOn } as Record<string, unknown>,
      },
    );
    statements.push(
      this.ctx.db.insert(safetyEventInvestigation).values({
        id: investigationId,
        companyId: row.companyId,
        eventId: row.id,
        leadId: input.leadId,
        dueOn,
        instructions: input.instructions ?? null,
        sequenceOfEvents: null,
        lessonsLearned: null,
        assignedAt: now,
        assignedBy: principal.userId,
        startedAt: null,
        completedAt: null,
        completedBy: null,
        version: 1,
        createdAt: now,
        createdBy: principal.userId,
        updatedAt: now,
        updatedBy: principal.userId,
      }),
      ...members.map((userId) =>
        this.ctx.db.insert(safetyEventInvestigationMember).values({
          id: generateId(),
          companyId: row.companyId,
          investigationId,
          userId,
          addedAt: now,
          addedBy: principal.userId,
          removedAt: null,
          removedBy: null,
        }),
      ),
      ...(await this.ctx.notify(
        "safety_event.investigation_assigned",
        after,
        loaded.project,
        loaded.type,
        principal.userId,
        [input.leadId, ...members],
        async () => true,
        { dueOn },
      )),
    );
    return statements;
  }

  /** Recommendations with their actions, in one batch (T-89, consecutive numbers). */
  private async raiseActions(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    entries: readonly {
      recommendation: SafetyEventRecommendationRow;
      isNew: boolean;
      action: SafetyActionInput;
    }[],
  ): Promise<Statement[]> {
    const { row, project } = loaded;
    const engine = this.actionEngine();
    const base = await engine.peekNumber(project.id);
    const today = this.ctx.today(tenant);
    const reference = safetyEventReference(project.code, row.number) ?? "";
    const statements: Statement[] = [];
    for (const [index, entry] of entries.entries()) {
      const { recommendation, action } = entry;
      const prepared = await engine.prepare(
        {
          tenant,
          project: {
            id: project.id,
            code: project.code,
            status: project.status as ProjectStatus,
          },
          source: {
            module: "safety_event",
            recordId: recommendation.id,
            label: `${reference} · Recommendation ${String(recommendation.seq)}`,
          },
          type: ACTION_TYPE[recommendation.kind],
          priority:
            action.priority ??
            ((row.severity ?? row.reportedSeverity) as SafetySeverity),
          title: action.title,
          description: action.description ?? recommendation.description,
          ownerId: action.ownerId,
          dueOn: action.dueOn < today ? today : action.dueOn,
          place: {
            areaId: row.areaId,
            locationId: row.locationId,
            workZoneId: row.workZoneId,
          },
          createdBy: principal.userId,
        },
        base + index,
      );
      const now = new Date(this.ctx.now());
      if (entry.isNew) {
        statements.push(
          this.ctx.db
            .insert(safetyEventRecommendation)
            .values({ ...recommendation, status: "action_raised" }),
        );
      } else {
        statements.push(
          this.ctx.db
            .update(safetyEventRecommendation)
            .set({
              status: "action_raised",
              resolvedAt: null,
              updatedAt: now,
              updatedBy: principal.userId,
            })
            .where(eq(safetyEventRecommendation.id, recommendation.id)),
        );
      }
      statements.push(
        ...prepared.statements,
        ...this.ctx.record(principal.userId, row, project, loaded.type, {
          audit: "safety_event.action_raised",
          activity: "safety_event.action_raised",
          newValue: {
            recommendationId: recommendation.id,
            action: prepared.reference,
          },
          snapshot: {
            recommendationSeq: recommendation.seq,
            actionReference: prepared.reference,
          },
        }),
      );
    }
    return statements;
  }

  private async nextSeq(eventId: string): Promise<number> {
    const found = await this.ctx.db
      .select({
        max: sql<number | null>`max(${safetyEventRecommendation.seq})`,
      })
      .from(safetyEventRecommendation)
      .where(eq(safetyEventRecommendation.eventId, eventId))
      .get();
    return (found?.max ?? 0) + 1;
  }

  private newRecommendation(
    row: SafetyEventRow,
    seq: number,
    kind: RecommendationKind,
    description: string,
    by: string,
    addendum = false,
  ): SafetyEventRecommendationRow {
    const now = new Date(this.ctx.now());
    return {
      id: generateId(),
      companyId: row.companyId,
      projectId: row.projectId,
      eventId: row.id,
      seq,
      kind,
      description,
      status: "open",
      noActionReason: null,
      addendum,
      resolvedAt: null,
      createdAt: now,
      createdBy: by,
      updatedAt: now,
      updatedBy: by,
    };
  }

  private async act(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    actions: readonly SafetyActionInput[],
  ): Promise<Statement[]> {
    const { row } = loaded;
    if (row.investigationRequired) throw new InvestigationRequiredError();
    await this.assertClassified(row, loaded.type);
    const review = await this.reviewDecisionFields(loaded, principal);
    const first = await this.nextSeq(row.id);
    const entries = actions.map((action, index) => ({
      recommendation: this.newRecommendation(
        row,
        first + index,
        "immediate",
        action.description ?? action.title,
        principal.userId,
      ),
      isNew: true,
      action,
    }));
    const raised = await this.raiseActions(tenant, loaded, principal, entries);
    const { statements } = this.move(
      loaded,
      principal,
      "corrective_action",
      review,
      "safety_event.classified",
      {
        newValue: { decision: "act", actions: actions.length },
      },
    );
    return [...statements, ...raised];
  }

  private async close(
    loaded: Loaded,
    principal: Principal,
    input: Extract<TransitionInput, { to: "close" }>,
  ): Promise<Statement[]> {
    const { row } = loaded;
    let extra: Partial<SafetyEventRow>;
    if (row.status === "reported") {
      // "No further action" from review (O-174).
      if (row.investigationRequired) throw new InvestigationRequiredError();
      await this.assertClassified(row, loaded.type);
      if (!loaded.access.manage && !loaded.access.close)
        throw new ForbiddenError();
      extra = {
        ...(await this.reviewDecisionFields(
          { ...loaded, access: { ...loaded.access, manage: true } },
          principal,
        )),
        closureKind: "no_further_action",
      };
    } else {
      const recommendations = await this.service.recommendationRows(row.id);
      if (
        recommendations.some(
          (r) => r.status === "open" || r.status === "action_raised",
        )
      )
        throw new OpenActionsError();
      if (row.investigationRequired && !loaded.investigation?.completedAt)
        throw new InvestigationRequiredError();
      if (
        loaded.investigation &&
        loaded.investigation.leadId === principal.userId
      ) {
        const others = (
          await this.ctx.audience.projectPermissionHolders(
            row.companyId,
            row.projectId,
            "projects.safety_events.close",
            this.ctx.resolver,
          )
        ).filter((u) => u !== principal.userId);
        if (others.length > 0) throw new SelfClosureError();
      }
      extra = { closureKind: "completed" };
    }
    const now = new Date(this.ctx.now());
    const { statements, after } = this.move(
      loaded,
      principal,
      "closed",
      {
        ...extra,
        closedAt: now,
        closedBy: principal.userId,
        closureSummary: input.summary,
      },
      "safety_event.closed",
      {
        newValue: {
          kind: extra.closureKind,
          summaryLength: input.summary.length,
        },
      },
    );
    statements.push(
      ...(await this.ctx.notify(
        "safety_event.closed",
        after,
        loaded.project,
        loaded.type,
        principal.userId,
        [
          row.reportedBy,
          ...(loaded.investigation ? [loaded.investigation.leadId] : []),
        ],
        this.service.canSee(loaded),
      )),
    );
    return statements;
  }

  private async reassign(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    input: Extract<TransitionInput, { to: "reassign" }>,
  ): Promise<Statement[]> {
    const { row, investigation } = loaded;
    if (!investigation) throw new SafetyEventTransitionError(row.status);
    const leadId = input.leadId ?? investigation.leadId;
    if (
      leadId !== investigation.leadId &&
      (!input.reason || input.reason.length < SAFETY_EVENT_LIMITS.reasonMin)
    ) {
      throw new ValidationError([{ path: "reason", message: "required" }]);
    }
    const members = await this.assertTeam(
      tenant,
      loaded,
      leadId,
      input.memberIds ?? loaded.members,
    );
    const now = new Date(this.ctx.now());
    const removed = loaded.members.filter((m) => !members.includes(m));
    const added = members.filter((m) => !loaded.members.includes(m));
    const { statements, after } = this.move(
      loaded,
      principal,
      row.status,
      {},
      "safety_event.investigation_reassigned",
      {
        newValue: {
          from: investigation.leadId,
          to: leadId,
          added,
          removed,
          reason: input.reason ?? null,
        },
        snapshot: input.reason ? { reason: input.reason.slice(0, 200) } : {},
      },
    );
    statements.push(
      this.ctx.db
        .update(safetyEventInvestigation)
        .set({
          leadId,
          version: investigation.version + 1,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(eq(safetyEventInvestigation.id, investigation.id)),
      ...removed.map((userId) =>
        this.ctx.db
          .update(safetyEventInvestigationMember)
          .set({ removedAt: now, removedBy: principal.userId })
          .where(
            and(
              eq(
                safetyEventInvestigationMember.investigationId,
                investigation.id,
              ),
              eq(safetyEventInvestigationMember.userId, userId),
              isNull(safetyEventInvestigationMember.removedAt),
            ),
          ),
      ),
      ...added.map((userId) =>
        this.ctx.db.insert(safetyEventInvestigationMember).values({
          id: generateId(),
          companyId: row.companyId,
          investigationId: investigation.id,
          userId,
          addedAt: now,
          addedBy: principal.userId,
          removedAt: null,
          removedBy: null,
        }),
      ),
    );
    if (leadId !== investigation.leadId) {
      // The old lead stays on as nobody: they lose access unless they still hold a permission.
      statements.push(
        ...(await this.ctx.notify(
          "safety_event.investigation_unassigned",
          after,
          loaded.project,
          loaded.type,
          principal.userId,
          [investigation.leadId, ...removed],
          async () => true,
        )),
        ...(await this.ctx.notify(
          "safety_event.investigation_assigned",
          after,
          loaded.project,
          loaded.type,
          principal.userId,
          [leadId, ...added],
          async () => true,
          { dueOn: investigation.dueOn },
        )),
      );
    } else {
      statements.push(
        ...(await this.ctx.notify(
          "safety_event.investigation_unassigned",
          after,
          loaded.project,
          loaded.type,
          principal.userId,
          removed,
          async () => true,
        )),
        ...(await this.ctx.notify(
          "safety_event.investigation_assigned",
          after,
          loaded.project,
          loaded.type,
          principal.userId,
          added,
          async () => true,
          { dueOn: investigation.dueOn },
        )),
      );
    }
    return statements;
  }

  private async complete(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
  ): Promise<Statement[]> {
    const { row, investigation } = loaded;
    if (!investigation || investigation.completedAt)
      throw new SafetyEventTransitionError(row.status);
    const [causes, recommendations] = await Promise.all([
      this.service.causeRows(row.id),
      this.service.recommendationRows(row.id),
    ]);
    const missing: string[] = [];
    if (!investigation.sequenceOfEvents) missing.push("sequenceOfEvents");
    if (!causes.some((c) => c.kind === "immediate"))
      missing.push("immediateCauses");
    if (!causes.some((c) => c.kind === "root")) missing.push("rootCauses");
    const nonImmediate = recommendations.filter((r) => r.kind !== "immediate");
    if (nonImmediate.length === 0) missing.push("recommendations");
    if (!investigation.lessonsLearned) missing.push("lessonsLearned");
    const undecided = recommendations.filter((r) => r.status === "open");
    for (const r of undecided) missing.push(`recommendations.${String(r.seq)}`);
    if (missing.length > 0) throw new InvestigationIncompleteError(missing);
    const now = new Date(this.ctx.now());
    const allResolved = recommendations.every(
      (r) => r.status === "resolved" || r.status === "no_action",
    );
    const to = allResolved ? "verification" : "corrective_action";
    const { statements, after } = this.move(
      loaded,
      principal,
      to,
      {},
      "safety_event.investigation_completed",
      {
        newValue: {
          causes: causes.length,
          recommendations: recommendations.length,
        },
      },
    );
    statements.push(
      this.ctx.db
        .update(safetyEventInvestigation)
        .set({
          completedAt: now,
          completedBy: principal.userId,
          version: investigation.version + 1,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(eq(safetyEventInvestigation.id, investigation.id)),
    );
    const closers = (
      await this.ctx.audience.projectPermissionHolders(
        row.companyId,
        row.projectId,
        "projects.safety_events.close",
        this.ctx.resolver,
      )
    ).filter((u) => u !== investigation.leadId);
    statements.push(
      ...(await this.ctx.notify(
        allResolved
          ? "safety_event.verification_ready"
          : "safety_event.investigation_completed",
        after,
        loaded.project,
        loaded.type,
        principal.userId,
        [...(row.reviewedBy ? [row.reviewedBy] : []), ...closers],
        this.service.canSee(loaded),
      )),
    );
    void tenant;
    return statements;
  }

  private async returnInvestigation(
    loaded: Loaded,
    principal: Principal,
    reason: string,
  ): Promise<Statement[]> {
    const { row, investigation } = loaded;
    if (!investigation) throw new SafetyEventTransitionError(row.status);
    if (investigation.leadId === principal.userId) throw new SelfClosureError();
    const now = new Date(this.ctx.now());
    const { statements, after } = this.move(
      loaded,
      principal,
      "under_investigation",
      {},
      "safety_event.returned",
      {
        newValue: { reason },
        snapshot: { reason: reason.slice(0, 200) },
      },
    );
    statements.push(
      this.ctx.db
        .update(safetyEventInvestigation)
        .set({
          completedAt: null,
          completedBy: null,
          version: investigation.version + 1,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(eq(safetyEventInvestigation.id, investigation.id)),
      ...(await this.ctx.notify(
        "safety_event.returned",
        after,
        loaded.project,
        loaded.type,
        principal.userId,
        [investigation.leadId],
        async () => true,
        {
          reason: reason.slice(0, 120),
        },
      )),
    );
    return statements;
  }

  private async void(
    tenant: TenantCompany,
    loaded: Loaded,
    principal: Principal,
    input: Extract<TransitionInput, { to: "void" }>,
  ): Promise<Statement[]> {
    const { row } = loaded;
    const recommendations = await this.service.recommendationRows(row.id);
    if (recommendations.some((r) => r.status === "action_raised"))
      throw new OpenActionsError();
    let duplicateOf: string | null = null;
    if (input.kind === "duplicate") {
      if (!input.duplicateOf)
        throw new ValidationError([
          { path: "duplicateOf", message: "required" },
        ]);
      const other = await this.service.findRow(
        tenant.id,
        row.projectId,
        input.duplicateOf,
      );
      if (!other || other.id === row.id)
        throw new ValidationError([
          { path: "duplicateOf", message: "invalid" },
        ]);
      duplicateOf = other.id;
    }
    const now = new Date(this.ctx.now());
    const { statements, after } = this.move(
      loaded,
      principal,
      row.status,
      {
        voidedAt: now,
        voidedBy: principal.userId,
        voidKind: input.kind,
        voidReason: input.reason,
        duplicateOf,
      },
      "safety_event.voided",
      {
        newValue: { kind: input.kind, reason: input.reason, duplicateOf },
        snapshot: { reason: input.reason.slice(0, 200) },
      },
    );
    statements.push(
      ...(await this.ctx.notify(
        "safety_event.voided",
        after,
        loaded.project,
        loaded.type,
        principal.userId,
        [row.reportedBy],
        async () => true,
        {
          reason: input.reason.slice(0, 120),
        },
      )),
    );
    return statements;
  }

  // ---- Investigation content (US-044) ------------------------------------------------------

  private assertInvestigating(loaded: Loaded): void {
    this.assertOpen(loaded);
    if (!loaded.access.team) throw new ForbiddenError();
    if (
      loaded.row.status !== "under_investigation" ||
      !loaded.investigation ||
      loaded.investigation.completedAt
    ) {
      throw new SafetyEventLockedError();
    }
  }

  async saveInvestigation(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    input: InvestigationInput,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertInvestigating(loaded);
    const investigation = loaded.investigation;
    if (!investigation) throw new SafetyEventLockedError();
    if (input.baseVersion !== investigation.version)
      throw new InvestigationChangedError();
    const next: Record<string, unknown> = {};
    if (input.sequenceOfEvents !== undefined)
      next.sequenceOfEvents = input.sequenceOfEvents;
    if (input.lessonsLearned !== undefined)
      next.lessonsLearned = input.lessonsLearned;
    const now = new Date(this.ctx.now());
    await this.commitInvestigation(loaded, [
      this.ctx.db
        .update(safetyEventInvestigation)
        .set({
          ...next,
          ...(investigation.startedAt ? {} : { startedAt: now }),
          version: investigation.version + 1,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(
          and(
            eq(safetyEventInvestigation.id, investigation.id),
            eq(safetyEventInvestigation.version, investigation.version),
          ),
        ),
      this.investigationGuard(investigation.id, investigation.version + 1),
      ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
        audit: "safety_event.investigation_updated",
        activity: "safety_event.investigation_updated",
        newValue: { sections: Object.keys(next) },
        snapshot: { status: Object.keys(next).join(",") },
      }),
    ]);
    return this.service.detail(tenant, project, principal, id);
  }

  private investigationGuard(
    investigationId: string,
    version: number,
  ): Statement {
    return this.ctx.db
      .select({
        ok: sql<number>`case when ${safetyEventInvestigation.version} = ${version} then 1 else json('investigation changed') end`,
      })
      .from(safetyEventInvestigation)
      .where(eq(safetyEventInvestigation.id, investigationId));
  }

  private async commitInvestigation(
    loaded: Loaded,
    statements: Statement[],
  ): Promise<void> {
    try {
      await new UnitOfWork(this.ctx.db).add(...statements).commit();
    } catch (error) {
      const text = String(
        (error as { message?: unknown } | null)?.message ?? error,
      );
      if (text.includes("malformed JSON"))
        throw new InvestigationChangedError();
      throw error;
    }
    void loaded;
  }

  async saveCauses(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    input: CausesInput,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertInvestigating(loaded);
    const investigation = loaded.investigation;
    if (!investigation) throw new SafetyEventLockedError();
    if (input.baseVersion !== investigation.version)
      throw new InvestigationChangedError();
    if (input.kind !== "contributing") {
      const list =
        input.kind === "immediate" ? "immediate_cause" : "root_cause";
      const current = (await this.service.causeRows(id))
        .filter((c) => c.kind === input.kind)
        .map((c) => c.categoryId);
      for (const [index, item] of input.items.entries()) {
        if (!item.categoryId) {
          throw new ValidationError([
            { path: `items.${String(index)}.categoryId`, message: "required" },
          ]);
        }
        const category = await this.ctx.db
          .select()
          .from(safetyListItem)
          .where(
            and(
              eq(safetyListItem.companyId, tenant.id),
              eq(safetyListItem.id, item.categoryId),
            ),
          )
          .get();
        if (
          category?.list !== list ||
          (!category.active && !current.includes(category.id))
        ) {
          throw new ValidationError([
            { path: `items.${String(index)}.categoryId`, message: "invalid" },
          ]);
        }
      }
    }
    const now = new Date(this.ctx.now());
    const statements: Statement[] = [
      this.ctx.db
        .update(safetyEventCause)
        .set({ removedAt: now })
        .where(
          and(
            eq(safetyEventCause.eventId, id),
            eq(safetyEventCause.kind, input.kind),
            isNull(safetyEventCause.removedAt),
          ),
        ),
      ...input.items.map((item, index) =>
        this.ctx.db.insert(safetyEventCause).values({
          id: generateId(),
          companyId: tenant.id,
          eventId: id,
          kind: input.kind,
          categoryId:
            input.kind === "contributing" ? null : (item.categoryId ?? null),
          description: item.description,
          whys: input.kind === "root" ? item.whys : [],
          position: index + 1,
          removedAt: null,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
      ),
      this.ctx.db
        .update(safetyEventInvestigation)
        .set({
          ...(investigation.startedAt ? {} : { startedAt: now }),
          version: investigation.version + 1,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(
          and(
            eq(safetyEventInvestigation.id, investigation.id),
            eq(safetyEventInvestigation.version, investigation.version),
          ),
        ),
      this.investigationGuard(investigation.id, investigation.version + 1),
      ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
        audit: "safety_event.investigation_updated",
        activity: "safety_event.investigation_updated",
        newValue: { kind: input.kind, count: input.items.length },
        snapshot: { status: input.kind, count: input.items.length },
      }),
    ];
    await this.commitInvestigation(loaded, statements);
    return this.service.detail(tenant, project, principal, id);
  }

  // ---- Recommendations and actions (US-044, T-89) ------------------------------------------

  private assertMayRaise(loaded: Loaded): void {
    this.assertOpen(loaded);
    if (!loaded.access.manage && !loaded.access.lead && !loaded.access.team)
      throw new ForbiddenError();
    if (
      !["under_investigation", "corrective_action", "verification"].includes(
        loaded.row.status,
      )
    ) {
      throw new SafetyEventTransitionError(loaded.row.status);
    }
  }

  async addRecommendation(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    input: RecommendationInput,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertMayRaise(loaded);
    if (
      loaded.row.status !== "under_investigation" &&
      !loaded.access.manage &&
      !loaded.access.lead
    ) {
      throw new ForbiddenError();
    }
    const existing = await this.service.recommendationRows(id);
    if (existing.length >= SAFETY_EVENT_LIMITS.recommendationsMax) {
      throw new ValidationError([
        { path: "description", message: "limitReached" },
      ]);
    }
    const recommendation = this.newRecommendation(
      loaded.row,
      await this.nextSeq(id),
      input.kind,
      input.description,
      principal.userId,
    );
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db.insert(safetyEventRecommendation).values(recommendation),
        ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
          audit: "safety_event.investigation_updated",
          activity: "safety_event.investigation_updated",
          newValue: { recommendation: recommendation.seq, kind: input.kind },
          snapshot: { recommendationSeq: recommendation.seq },
        }),
      )
      .commit();
    return this.service.detail(tenant, project, principal, id);
  }

  async updateRecommendation(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    recommendationId: string,
    input: RecommendationInput,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertInvestigating(loaded);
    const recommendation = (await this.service.recommendationRows(id)).find(
      (r) => r.id === recommendationId,
    );
    if (!recommendation) throw new NotFoundError();
    if (recommendation.status !== "open") throw new RecommendationLockedError();
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(safetyEventRecommendation)
          .set({
            kind: input.kind,
            description: input.description,
            updatedAt: new Date(this.ctx.now()),
            updatedBy: principal.userId,
          })
          .where(eq(safetyEventRecommendation.id, recommendationId)),
        ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
          audit: "safety_event.investigation_updated",
          activity: "safety_event.investigation_updated",
          newValue: { recommendation: recommendation.seq },
          snapshot: { recommendationSeq: recommendation.seq },
        }),
      )
      .commit();
    return this.service.detail(tenant, project, principal, id);
  }

  async raiseAction(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    recommendationId: string,
    input: RaiseInput,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertMayRaise(loaded);
    const recommendation = (await this.service.recommendationRows(id)).find(
      (r) => r.id === recommendationId,
    );
    if (!recommendation) throw new NotFoundError();
    if (
      recommendation.status === "no_action" ||
      recommendation.status === "resolved"
    ) {
      // A resolved recommendation may get another action; reopening goes through the action.
      if (recommendation.status === "no_action")
        throw new RecommendationLockedError();
    }
    await withActionNumber(async () => {
      const statements = await this.raiseActions(tenant, loaded, principal, [
        { recommendation, isNew: false, action: input },
      ]);
      if (loaded.row.status === "verification") {
        statements.push(
          ...this.move(
            loaded,
            principal,
            "corrective_action",
            {},
            "safety_event.action_raised",
            {},
          ).statements.slice(0, 2),
        );
      }
      await this.service.commitGuarded(loaded.row, statements);
    });
    return this.service.detail(tenant, project, principal, id);
  }

  async noAction(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    recommendationId: string,
    reason: string,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    this.assertMayRaise(loaded);
    const recommendation = (await this.service.recommendationRows(id)).find(
      (r) => r.id === recommendationId,
    );
    if (!recommendation) throw new NotFoundError();
    if (recommendation.status !== "open") throw new RecommendationLockedError();
    const now = new Date(this.ctx.now());
    const statements: Statement[] = [
      this.ctx.db
        .update(safetyEventRecommendation)
        .set({
          status: "no_action",
          noActionReason: reason,
          updatedAt: now,
          updatedBy: principal.userId,
        })
        .where(
          and(
            eq(safetyEventRecommendation.id, recommendationId),
            eq(safetyEventRecommendation.status, "open"),
          ),
        ),
      ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
        audit: "safety_event.recommendation_no_action",
        activity: "safety_event.recommendation_no_action",
        newValue: { recommendationId, reason },
        snapshot: {
          recommendationSeq: recommendation.seq,
          reason: reason.slice(0, 200),
        },
      }),
    ];
    const others = (await this.service.recommendationRows(id)).filter(
      (r) => r.id !== recommendationId,
    );
    if (
      loaded.row.status === "corrective_action" &&
      others.every((r) => r.status === "resolved" || r.status === "no_action")
    ) {
      statements.push(
        ...(await verificationStatements(
          this.ctx,
          loaded.row,
          loaded.project,
          loaded.type,
          principal.userId,
          now.getTime() + 1,
        )),
      );
    }
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    return this.service.detail(tenant, project, principal, id);
  }

  /** O-158: a new action from a closed event, as an addendum recommendation. */
  async addendumAction(
    tenant: TenantCompany,
    project: SafetyEventProject,
    principal: Principal,
    id: string,
    input: AddendumInput,
  ): Promise<SafetyEventDto> {
    const loaded = await this.service.load(tenant, project, principal, id);
    if (loaded.access.archived) throw new ProjectArchivedError();
    if (loaded.row.status !== "closed")
      throw new SafetyEventTransitionError(loaded.row.status);
    if (!loaded.access.granted.has("projects.actions.create"))
      throw new ForbiddenError();
    await withActionNumber(async () => {
      const recommendation = this.newRecommendation(
        loaded.row,
        await this.nextSeq(id),
        "improvement",
        input.recommendation,
        principal.userId,
        true,
      );
      const statements = await this.raiseActions(tenant, loaded, principal, [
        { recommendation, isNew: true, action: input },
      ]);
      statements.push(
        this.ctx.audit.entry({
          action: "safety_event.addendum_action_raised",
          actorUserId: principal.userId,
          companyId: loaded.row.companyId,
          projectId: loaded.row.projectId,
          entityType: "safety_event",
          entityId: loaded.row.id,
          newValue: { recommendationId: recommendation.id },
        }),
      );
      await new UnitOfWork(this.ctx.db).add(...statements).commit();
    });
    return this.service.detail(tenant, project, principal, id);
  }
}

/** Corrective Action → Verification, with the notice to closers (US-046 FR-1). */
async function verificationStatements(
  ctx: SafetyEventContext,
  row: SafetyEventRow,
  project: SafetyEventProject,
  type: SafetyEventTypeRow | null,
  actorUserId: string,
  at: number,
): Promise<Statement[]> {
  if (row.status !== "corrective_action" || row.voidedAt !== null) return [];
  const now = new Date(at);
  const after: SafetyEventRow = {
    ...row,
    status: "verification",
    version: row.version + 1,
    updatedAt: now,
  };
  const investigation = await ctx.db
    .select()
    .from(safetyEventInvestigation)
    .where(eq(safetyEventInvestigation.eventId, row.id))
    .get();
  const closers = (
    await ctx.audience.projectPermissionHolders(
      row.companyId,
      row.projectId,
      "projects.safety_events.close",
      ctx.resolver,
    )
  ).filter((u) => u !== investigation?.leadId);
  return [
    ctx.db
      .update(safetyEvent)
      .set({ status: "verification", version: row.version + 1, updatedAt: now })
      .where(
        and(
          eq(safetyEvent.id, row.id),
          eq(safetyEvent.status, "corrective_action"),
        ),
      ),
    ...ctx.record(actorUserId, after, project, type, {
      audit: "safety_event.verification_ready",
      activity: "safety_event.verification_ready",
      changes: {
        before: { status: "corrective_action" },
        after: { status: "verification" },
      },
      at,
    }),
    ...(await ctx.notify(
      "safety_event.verification_ready",
      after,
      project,
      type,
      actorUserId,
      closers,
      async (userId) => {
        const granted = await ctx.projectPermissions(
          userId,
          row.companyId,
          row.projectId,
        );
        return granted.has("projects.view");
      },
    )),
  ];
}

/**
 * T-89: the action engine calls this inside its batch when an action raised from a
 * recommendation is closed or voided. The recommendation resolves (or opens again) and the
 * event moves to Verification (or back to Corrective Action).
 */
export async function onRecommendationActionChanged(
  input: ActionChange,
): Promise<Statement[]> {
  const { db, companyId, recordId } = input;
  const recommendation = await db
    .select()
    .from(safetyEventRecommendation)
    .where(
      and(
        eq(safetyEventRecommendation.companyId, companyId),
        eq(safetyEventRecommendation.id, recordId),
      ),
    )
    .get();
  if (!recommendation) return [];
  const row = await db
    .select()
    .from(safetyEvent)
    .where(eq(safetyEvent.id, recommendation.eventId))
    .get();
  if (!row) return [];
  const facts = await new ProjectDirectory(db).get(companyId, row.projectId);
  if (!facts) return [];
  const resolver = new PermissionResolver(db, () => input.now);
  const actions = await new ActionDirectory(db, resolver).actionsForSource(
    companyId,
    "safety_event",
    [recommendation.id],
  );
  const merged = actions.map((a) =>
    a.id === input.action.id
      ? {
          ...a,
          status: input.action.status as typeof a.status,
          voided: input.action.voided,
        }
      : a,
  );
  const active = merged.filter((a) => !a.voided);
  const status: SafetyEventRecommendationRow["status"] =
    active.length === 0
      ? "open"
      : active.every((a) => a.status === "closed")
        ? "resolved"
        : "action_raised";
  if (status === recommendation.status) return [];
  const ctx = new SafetyEventContext({
    db,
    meta: input.meta,
    clock: () => input.now,
    resolver,
  });
  const type =
    (await db
      .select()
      .from(safetyEventType)
      .where(eq(safetyEventType.id, row.typeId))
      .get()) ?? null;
  const project: SafetyEventProject = {
    id: facts.id,
    code: facts.code,
    status: facts.status,
  };
  const now = new Date(input.now);
  const reference = `${facts.code}-ACT-${String(input.action.number).padStart(4, "0")}`;
  const statements: Statement[] = [
    db
      .update(safetyEventRecommendation)
      .set({
        status,
        resolvedAt: status === "resolved" ? now : null,
        updatedAt: now,
        updatedBy: input.actorUserId,
      })
      .where(eq(safetyEventRecommendation.id, recommendation.id)),
    ...ctx.record(input.actorUserId, row, project, type, {
      audit:
        status === "resolved"
          ? "safety_event.recommendation_resolved"
          : "safety_event.recommendation_reopened",
      activity:
        status === "resolved"
          ? "safety_event.recommendation_resolved"
          : "safety_event.recommendation_reopened",
      newValue: {
        recommendationId: recommendation.id,
        action: reference,
        status,
      },
      snapshot: {
        recommendationSeq: recommendation.seq,
        actionReference: reference,
      },
      at: input.now + 10,
    }),
  ];
  if (row.status === "closed" || row.voidedAt !== null) return statements;
  if (status === "resolved") {
    const others = (
      await db
        .select()
        .from(safetyEventRecommendation)
        .where(eq(safetyEventRecommendation.eventId, row.id))
        .all()
    ).filter((r) => r.id !== recommendation.id);
    if (
      others.every((r) => r.status === "resolved" || r.status === "no_action")
    ) {
      statements.push(
        ...(await verificationStatements(
          ctx,
          row,
          project,
          type,
          input.actorUserId,
          input.now + 11,
        )),
      );
    }
  } else if (status === "open" && row.status === "verification") {
    statements.push(
      db
        .update(safetyEvent)
        .set({
          status: "corrective_action",
          version: row.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(safetyEvent.id, row.id),
            eq(safetyEvent.status, "verification"),
          ),
        ),
    );
  }
  return statements;
}
