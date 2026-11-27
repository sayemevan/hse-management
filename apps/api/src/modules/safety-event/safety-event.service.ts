import {
  ACTIVITY_ACTIONS,
  type ActivityEntryDto,
  allowedSafetyEventTransitions,
  COMMENT_LIMITS,
  type CommentDto,
  type CommentPageDto,
  daysBetween,
  generateId,
  type MySafetyEventsPageDto,
  type MySafetyEventsQuery,
  type MySafetyEventTab,
  occurredAtIssue,
  parseSafetyEventNumber,
  type PlaceSelection,
  reportedLate,
  type reportSafetyEventRequestSchema,
  SAFETY_EVENT_FILE_RULES,
  SAFETY_EVENT_LIMITS,
  type SafetyEventAccessDto,
  type SafetyEventCountsDto,
  type SafetyEventDto,
  type SafetyEventFileDto,
  type SafetyEventListQuery,
  type SafetyEventPageDto,
  safetyEventReference,
  type SafetyEventSummaryDto,
  type SafetyPersonDto,
  type safetyPersonSchema,
  type SafetyPersonRefDto,
  type SafetyRecommendationDto,
  type SafetyWitnessDto,
  severityAtLeast,
  type TimelinePageDto,
  type updateSafetyEventRequestSchema,
  type updateWitnessRequestSchema,
  type reportWitnessSchema,
} from "@hse/shared";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { z } from "zod";

import type { Principal } from "../../core/auth/principal";
import type { IdempotencyClaim } from "../../core/context/app-context";
import type { TenantCompany } from "../../core/context/tenant";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "../../core/errors/app-error";
import { type Statement, UnitOfWork } from "../../database/unit-of-work";
import { parseActivityCursor } from "../../platform/activity";
import { type CommentTarget, parseCommentCursor } from "../../platform/comment";
import type { OpenedFile } from "../../platform/file-storage";
import {
  isVersionGuardFailure,
  offlineAudit,
  type OfflineMeta,
  type PreparedUpdate,
  RecordIdTakenError,
  SyncConflictError,
  SyncConflictService,
  type SyncSnapshot,
} from "../../platform/sync";
import { ActionDirectory } from "../action";
import { userSummaries } from "../identity";
import { ProjectArchivedError, withRecordNumber } from "../project";
import { WorkforceDirectory } from "../workforce";
import {
  SafetyEventContext,
  type SafetyEventProject,
} from "./safety-event-context";
import {
  EventTimeInvalidError,
  EventTypeInactiveError,
  NotReporterError,
  PersonLimitError,
  PlaceRequiredError,
  ProjectNotAcceptingRecordsError,
  SafetyEventFileLimitError,
  SafetyEventLockedError,
  SafetyEventTransitionError,
  SeverityBelowMinimumError,
  WitnessLimitError,
} from "./safety-event.errors";
import {
  safetyEvent,
  safetyEventCategoryLink,
  safetyEventCause,
  type SafetyEventCauseRow,
  safetyEventFile,
  type SafetyEventFileRow,
  safetyEventInvestigation,
  safetyEventInvestigationMember,
  type SafetyEventInvestigationRow,
  safetyEventPerson,
  type SafetyEventPersonRow,
  safetyEventRecommendation,
  type SafetyEventRecommendationRow,
  type SafetyEventRow,
  safetyEventType,
  type SafetyEventTypeRow,
  safetyEventWitness,
  type SafetyEventWitnessRow,
  safetyListItem,
} from "./safety-event.schema";
import { safetyEventSyncEntity } from "./safety-event-sync";
import { SafetySettingsService } from "./settings.service";

export const SAFETY_EVENT_NUMBER_INDEX =
  "safety_event.project_id, safety_event.number";
const DAY_MS = 24 * 60 * 60 * 1000;
/** SQLite raises this for `json('…')`: a guard of the batch failed (T-58 pattern). */
const GUARD = "malformed JSON";

type ProjectArg = SafetyEventProject;
type ReportInput = z.output<typeof reportSafetyEventRequestSchema>;
type UpdateInput = z.output<typeof updateSafetyEventRequestSchema>;
type PersonInput = z.output<typeof safetyPersonSchema>;
type WitnessInput = z.output<typeof reportWitnessSchema>;
type WitnessUpdateInput = z.output<typeof updateWitnessRequestSchema>;

/** T-93: what the caller may do with one event. */
export interface SafetyEventAccess {
  userId: string;
  granted: ReadonlySet<string>;
  archived: boolean;
  reporter: boolean;
  viewer: boolean;
  team: boolean;
  lead: boolean;
  manage: boolean;
  close: boolean;
  sensitive: boolean;
}

export interface Loaded {
  row: SafetyEventRow;
  type: SafetyEventTypeRow;
  project: SafetyEventProject;
  access: SafetyEventAccess;
  investigation: SafetyEventInvestigationRow | null;
  members: string[];
}

export interface CreateResult {
  dto: SafetyEventDto;
  replayed: boolean;
}

export function placeOf(
  row: Pick<SafetyEventRow, "areaId" | "locationId" | "workZoneId">,
): string | null {
  return row.workZoneId ?? row.locationId ?? row.areaId;
}

function isUnique(error: unknown, text: string): boolean {
  const message = String(
    (error as { message?: unknown } | null)?.message ?? error,
  );
  return message.includes("UNIQUE") && message.includes(text);
}

/** T-93: the one access rule. */
export function safetyEventAccess(
  userId: string,
  granted: ReadonlySet<string>,
  row: Pick<SafetyEventRow, "reportedBy">,
  investigation: Pick<SafetyEventInvestigationRow, "leadId"> | null,
  members: readonly string[],
  archived: boolean,
): SafetyEventAccess {
  const lead = investigation?.leadId === userId;
  const team = lead || members.includes(userId);
  return {
    userId,
    granted,
    archived,
    reporter: row.reportedBy === userId,
    viewer: granted.has("projects.safety_events.view"),
    team,
    lead,
    manage: granted.has("projects.safety_events.manage"),
    close: granted.has("projects.safety_events.close"),
    sensitive: team || granted.has("projects.safety_events.sensitive.view"),
  };
}

export function mayView(access: SafetyEventAccess): boolean {
  return access.reporter || access.viewer || access.team;
}

/** Witness contacts and statements (O-172). */
function mayReadStatements(access: SafetyEventAccess): boolean {
  return access.team || access.manage || access.close || access.sensitive;
}

/** Investigation, causes, recommendations: viewers and the team; not a reporter alone (O-167). */
function mayReadInvestigation(access: SafetyEventAccess): boolean {
  return access.viewer || access.team || access.manage;
}

/** PLT-33, US-040 – US-046: reports, access, people, witnesses, files, lists, history. */
export class SafetyEventService {
  readonly settings: SafetySettingsService;

  constructor(readonly ctx: SafetyEventContext) {
    this.settings = new SafetySettingsService(ctx.deps);
  }

  // ---- Loading and access ----------------------------------------------------------------

  async findRow(
    companyId: string,
    projectId: string,
    id: string,
  ): Promise<SafetyEventRow | undefined> {
    return this.ctx.db
      .select()
      .from(safetyEvent)
      .where(
        and(
          eq(safetyEvent.companyId, companyId),
          eq(safetyEvent.projectId, projectId),
          eq(safetyEvent.id, id),
        ),
      )
      .get();
  }

  async investigationOf(
    eventId: string,
  ): Promise<{
    investigation: SafetyEventInvestigationRow | null;
    members: string[];
  }> {
    const investigation =
      (await this.ctx.db
        .select()
        .from(safetyEventInvestigation)
        .where(eq(safetyEventInvestigation.eventId, eventId))
        .get()) ?? null;
    if (!investigation) return { investigation: null, members: [] };
    const rows = await this.ctx.db
      .select({ userId: safetyEventInvestigationMember.userId })
      .from(safetyEventInvestigationMember)
      .where(
        and(
          eq(safetyEventInvestigationMember.investigationId, investigation.id),
          isNull(safetyEventInvestigationMember.removedAt),
        ),
      )
      .all();
    return { investigation, members: rows.map((r) => r.userId) };
  }

  async typeRow(id: string): Promise<SafetyEventTypeRow> {
    const row = await this.ctx.db
      .select()
      .from(safetyEventType)
      .where(eq(safetyEventType.id, id))
      .get();
    if (!row) throw new NotFoundError();
    return row;
  }

  async load(
    tenant: Pick<TenantCompany, "id">,
    project: ProjectArg,
    principal: Principal,
    id: string,
  ): Promise<Loaded> {
    const row = await this.findRow(tenant.id, project.id, id);
    if (!row) throw new NotFoundError();
    const { investigation, members } = await this.investigationOf(row.id);
    const granted = await this.ctx.projectPermissions(
      principal.userId,
      tenant.id,
      project.id,
    );
    const access = safetyEventAccess(
      principal.userId,
      granted,
      row,
      investigation,
      members,
      project.status === "archived",
    );
    if (!mayView(access)) throw new NotFoundError();
    return {
      row,
      type: await this.typeRow(row.typeId),
      project,
      access,
      investigation,
      members,
    };
  }

  /** T-41, T-93: may this user see the event now? Used for notification recipients. */
  canSee(
    loaded: Pick<Loaded, "row" | "investigation" | "members">,
  ): (userId: string) => Promise<boolean> {
    return async (userId) => {
      const granted = await this.ctx.projectPermissions(
        userId,
        loaded.row.companyId,
        loaded.row.projectId,
      );
      if (!granted.has("projects.view")) return false;
      return mayView(
        safetyEventAccess(
          userId,
          granted,
          loaded.row,
          loaded.investigation,
          loaded.members,
          false,
        ),
      );
    };
  }

  assertWritable(loaded: Loaded): void {
    if (loaded.access.archived) throw new ProjectArchivedError();
    if (loaded.row.voidedAt !== null || loaded.row.status === "closed")
      throw new SafetyEventLockedError();
  }

  // ---- DTOs ------------------------------------------------------------------------------

  async people(
    ids: readonly (string | null | undefined)[],
  ): Promise<Map<string, SafetyPersonRefDto>> {
    const summaries = await userSummaries(
      this.ctx.db,
      ids.filter((id): id is string => typeof id === "string"),
    );
    return new Map(
      [...summaries].map(([id, s]) => [id, { id, name: s.fullName }]),
    );
  }

  private async placeNames(
    companyId: string,
    projectId: string,
    rows: readonly SafetyEventRow[],
  ): Promise<Map<string, string>> {
    const ids = rows.map(placeOf).filter((id): id is string => id !== null);
    const resolved = await this.ctx.places.resolveMany(
      companyId,
      projectId,
      ids,
    );
    return new Map(
      [...resolved].map(([id, place]) => [id, place.names.join(" › ")]),
    );
  }

  private async overdueDays(
    tenant: Pick<TenantCompany, "timeZone">,
    rows: readonly SafetyEventRow[],
  ): Promise<Map<string, number>> {
    const open = rows
      .filter((r) => r.status === "under_investigation")
      .map((r) => r.id);
    if (open.length === 0) return new Map();
    const investigations = await this.ctx.db
      .select({
        eventId: safetyEventInvestigation.eventId,
        dueOn: safetyEventInvestigation.dueOn,
      })
      .from(safetyEventInvestigation)
      .where(inArray(safetyEventInvestigation.eventId, open))
      .all();
    const today = this.ctx.today(tenant);
    return new Map(
      investigations.map((i) => [
        i.eventId,
        i.dueOn < today ? daysBetween(i.dueOn, today) : 0,
      ]),
    );
  }

  async summaries(
    tenant: Pick<TenantCompany, "id" | "timeZone">,
    rows: readonly SafetyEventRow[],
    projects: ReadonlyMap<string, SafetyEventProject>,
  ): Promise<SafetyEventSummaryDto[]> {
    if (rows.length === 0) return [];
    const typeIds = [...new Set(rows.map((r) => r.typeId))];
    const [types, reporters, overdue] = await Promise.all([
      this.ctx.db
        .select()
        .from(safetyEventType)
        .where(inArray(safetyEventType.id, typeIds))
        .all(),
      this.people(rows.map((r) => r.reportedBy)),
      this.overdueDays(tenant, rows),
    ]);
    const typeById = new Map(types.map((t) => [t.id, t]));
    const placeNames = new Map<string, string>();
    for (const projectId of new Set(rows.map((r) => r.projectId))) {
      const names = await this.placeNames(
        tenant.id,
        projectId,
        rows.filter((r) => r.projectId === projectId),
      );
      for (const [id, name] of names) placeNames.set(id, name);
    }
    return rows.map((row) => {
      const type = typeById.get(row.typeId);
      const code = projects.get(row.projectId)?.code ?? "";
      const placeId = placeOf(row);
      return {
        id: row.id,
        projectId: row.projectId,
        projectCode: code,
        number: row.number,
        reference: safetyEventReference(code, row.number),
        typeId: row.typeId,
        typeNameEn: type?.nameEn ?? null,
        typeNameAr: type?.nameAr ?? null,
        family: row.family,
        title: row.title,
        status: row.status,
        severity: row.severity,
        reportedSeverity: row.reportedSeverity,
        riskBandKey: row.riskBand,
        riskBandLabel: row.riskBandLabel ?? null,
        occurredAt: row.occurredAt.getTime(),
        reportedLate: row.reportedLate,
        placeName: placeId ? (placeNames.get(placeId) ?? null) : null,
        reportedBy: reporters.get(row.reportedBy) ?? null,
        underReview: row.status === "reported" && row.reviewStartedAt !== null,
        voided: row.voidedAt !== null,
        investigationOverdueDays: overdue.get(row.id) ?? 0,
        urgent:
          row.voidedAt === null &&
          row.status !== "closed" &&
          (row.severity ?? row.reportedSeverity) === "critical",
        version: row.version,
      };
    });
  }

  async fileRows(eventId: string): Promise<SafetyEventFileRow[]> {
    return this.ctx.db
      .select()
      .from(safetyEventFile)
      .where(
        and(
          eq(safetyEventFile.eventId, eventId),
          isNull(safetyEventFile.removedAt),
        ),
      )
      .orderBy(asc(safetyEventFile.createdAt))
      .all();
  }

  async personRows(eventId: string): Promise<SafetyEventPersonRow[]> {
    return this.ctx.db
      .select()
      .from(safetyEventPerson)
      .where(
        and(
          eq(safetyEventPerson.eventId, eventId),
          isNull(safetyEventPerson.removedAt),
        ),
      )
      .orderBy(asc(safetyEventPerson.createdAt))
      .all();
  }

  async witnessRows(eventId: string): Promise<SafetyEventWitnessRow[]> {
    return this.ctx.db
      .select()
      .from(safetyEventWitness)
      .where(
        and(
          eq(safetyEventWitness.eventId, eventId),
          isNull(safetyEventWitness.removedAt),
        ),
      )
      .orderBy(asc(safetyEventWitness.createdAt))
      .all();
  }

  async causeRows(eventId: string): Promise<SafetyEventCauseRow[]> {
    return this.ctx.db
      .select()
      .from(safetyEventCause)
      .where(
        and(
          eq(safetyEventCause.eventId, eventId),
          isNull(safetyEventCause.removedAt),
        ),
      )
      .orderBy(asc(safetyEventCause.kind), asc(safetyEventCause.position))
      .all();
  }

  async recommendationRows(
    eventId: string,
  ): Promise<SafetyEventRecommendationRow[]> {
    return this.ctx.db
      .select()
      .from(safetyEventRecommendation)
      .where(eq(safetyEventRecommendation.eventId, eventId))
      .orderBy(asc(safetyEventRecommendation.seq))
      .all();
  }

  async categoryIds(eventId: string): Promise<string[]> {
    const rows = await this.ctx.db
      .select({ id: safetyEventCategoryLink.categoryId })
      .from(safetyEventCategoryLink)
      .where(eq(safetyEventCategoryLink.eventId, eventId))
      .all();
    return rows.map((r) => r.id);
  }

  private async fileDtos(
    loaded: Loaded,
    rows: readonly SafetyEventFileRow[],
  ): Promise<SafetyEventFileDto[]> {
    const visible = rows.filter((f) => !f.sensitive || loaded.access.sensitive);
    if (visible.length === 0) return [];
    const files = await Promise.all(
      visible.map((f) => this.ctx.files.find(f.fileId, loaded.row.companyId)),
    );
    const uploaders = await this.people(visible.map((f) => f.createdBy));
    const editable = this.reporterMayEdit(loaded);
    return visible.flatMap((link, index) => {
      const file = files[index];
      if (!file) return [];
      return [
        {
          id: link.id,
          fileId: link.fileId,
          fileName: file.fileName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          sensitive: link.sensitive,
          witnessId: link.witnessId,
          uploadedBy: uploaders.get(link.createdBy) ?? null,
          uploadedAt: link.createdAt.getTime(),
          canRemove:
            editable &&
            link.createdBy === loaded.access.userId &&
            !link.sensitive,
        },
      ];
    });
  }

  private personDto(row: SafetyEventPersonRow): SafetyPersonDto {
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      workforceMemberId: row.workforceMemberId,
      userId: row.userId,
      injuryNature: row.injuryNature,
      bodyPart: row.bodyPart,
      treatment: row.treatment,
      daysLost: row.daysLost,
      detail: row.detail,
    };
  }

  private witnessDtos(
    loaded: Loaded,
    rows: readonly SafetyEventWitnessRow[],
    names: Map<string, SafetyPersonRefDto>,
  ): SafetyWitnessDto[] {
    const full = mayReadStatements(loaded.access);
    const statementsOpen =
      loaded.investigation?.completedAt === null ||
      loaded.investigation === null;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      company: row.company,
      workforceMemberId: row.workforceMemberId,
      userId: row.userId,
      contact: full ? row.contact : null,
      statement: full ? row.statement : null,
      statementOn: full ? row.statementOn : null,
      takenBy: full && row.takenBy ? (names.get(row.takenBy) ?? null) : null,
      hasStatement: row.statement !== null,
      restricted: !full,
      canEditStatement:
        this.mayWriteWitness(loaded) &&
        statementsOpen &&
        (row.statement === null || row.takenBy === loaded.access.userId),
      version: row.version,
    }));
  }

  async recommendationDtos(
    companyId: string,
    projectCode: string,
    rows: readonly SafetyEventRecommendationRow[],
  ): Promise<SafetyRecommendationDto[]> {
    const actions = await new ActionDirectory(
      this.ctx.db,
      this.ctx.resolver,
    ).actionsForSource(
      companyId,
      "safety_event",
      rows.map((r) => r.id),
    );
    const owners = await this.people(actions.map((a) => a.ownerId));
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      kind: row.kind,
      description: row.description,
      status: row.status,
      noActionReason: row.noActionReason,
      addendum: row.addendum,
      actions: actions
        .filter((a) => a.recordId === row.id)
        .map((a) => ({
          id: a.id,
          reference: `${projectCode}-ACT-${String(a.number).padStart(4, "0")}`,
          status: a.status,
          voided: a.voided,
          ownerName: owners.get(a.ownerId)?.name ?? null,
          dueOn: a.dueOn,
        })),
    }));
  }

  reporterMayEdit(loaded: Loaded): boolean {
    const { row, access } = loaded;
    return (
      access.reporter &&
      !access.archived &&
      row.status === "reported" &&
      row.reviewStartedAt === null &&
      row.voidedAt === null &&
      access.granted.has("projects.safety_events.report")
    );
  }

  /** O-169: the reporter reviews their own report only when nobody else can. */
  async mayReview(loaded: Loaded): Promise<boolean> {
    if (!loaded.access.reporter) return true;
    const others = (
      await this.reviewers(
        loaded.row.companyId,
        loaded.row.projectId,
        loaded.row.reportedBy,
      )
    ).filter((id) => id !== loaded.row.reportedBy);
    return others.length === 0;
  }

  mayWriteWitness(loaded: Loaded): boolean {
    const { row, access } = loaded;
    if (access.archived || row.voidedAt !== null || row.status === "closed")
      return false;
    return access.team || access.manage || this.reporterMayEdit(loaded);
  }

  mayWritePeople(loaded: Loaded): boolean {
    const { row, access } = loaded;
    if (access.archived || row.voidedAt !== null || row.status === "closed")
      return false;
    if (this.reporterMayEdit(loaded)) return true;
    return access.team || (access.manage && access.sensitive);
  }

  async toDto(
    tenant: Pick<TenantCompany, "id" | "timeZone">,
    loaded: Loaded,
  ): Promise<SafetyEventDto> {
    const { row, project, access, investigation, members } = loaded;
    const [summary] = await this.summaries(
      tenant,
      [row],
      new Map([[project.id, project]]),
    );
    if (!summary) throw new NotFoundError();
    const [categoryIds, people, witnesses, files, causes, recommendations] =
      await Promise.all([
        this.categoryIds(row.id),
        this.personRows(row.id),
        this.witnessRows(row.id),
        this.fileRows(row.id),
        investigation ? this.causeRows(row.id) : Promise.resolve([]),
        this.recommendationRows(row.id),
      ]);
    const categories =
      categoryIds.length > 0
        ? await this.ctx.db
            .select()
            .from(safetyListItem)
            .where(inArray(safetyListItem.id, categoryIds))
            .all()
        : [];
    const causeCategoryIds = causes.flatMap((c) =>
      c.categoryId ? [c.categoryId] : [],
    );
    const causeCategories =
      causeCategoryIds.length > 0
        ? await this.ctx.db
            .select()
            .from(safetyListItem)
            .where(inArray(safetyListItem.id, causeCategoryIds))
            .all()
        : [];
    const causeCategoryById = new Map(causeCategories.map((c) => [c.id, c]));
    const names = await this.people([
      row.reviewedBy,
      row.closedBy,
      investigation?.leadId,
      ...members,
      ...witnesses.map((w) => w.takenBy),
    ]);
    const readInvestigation = mayReadInvestigation(access);
    const today = this.ctx.today(tenant);
    const facts = {
      manage: access.manage && !access.archived,
      close: access.close && !access.archived,
      lead: access.lead && !access.archived,
      investigationRequired: row.investigationRequired,
      investigated: investigation !== null,
      voided: row.voidedAt !== null,
    };
    const accessDto: SafetyEventAccessDto = {
      reporter: access.reporter,
      viewer: access.viewer,
      team: access.team,
      lead: access.lead,
      manage: access.manage,
      close: access.close,
      sensitive: access.sensitive,
    };
    const open =
      !access.archived && row.voidedAt === null && row.status !== "closed";
    return {
      ...summary,
      description: row.description,
      categoryIds,
      categories: categories.map((c) => ({
        id: c.id,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
      })),
      areaId: row.areaId,
      locationId: row.locationId,
      workZoneId: row.workZoneId,
      latitude: row.latitude,
      longitude: row.longitude,
      immediateAction: row.immediateAction,
      potentialOutcome: row.potentialOutcome,
      damageDetails: row.damageDetails,
      environmentDetails: row.environmentDetails,
      risk:
        row.riskScore !== null && row.riskBand !== null
          ? {
              matrixVersion: row.riskMatrixVersion ?? 0,
              likelihood: row.riskLikelihood ?? 0,
              consequence: row.riskConsequence ?? 0,
              score: row.riskScore,
              bandKey: row.riskBand,
              bandLabel: row.riskBandLabel ?? { en: row.riskBand },
            }
          : null,
      investigationRequired: row.investigationRequired,
      reviewNote: readInvestigation ? row.reviewNote : null,
      reviewedBy: row.reviewedBy ? (names.get(row.reviewedBy) ?? null) : null,
      selfReviewed: row.selfReviewed,
      voidKind: row.voidKind,
      voidReason: row.voidReason,
      closureKind: row.closureKind,
      closureSummary: row.closureSummary,
      closedAt: row.closedAt?.getTime() ?? null,
      closedBy: row.closedBy ? (names.get(row.closedBy) ?? null) : null,
      followUpOf: row.followUpOf,
      offline: row.offline,
      capturedAt: row.capturedAt?.getTime() ?? null,
      receivedAt: row.receivedAt.getTime(),
      people:
        access.sensitive || this.reporterMayEdit(loaded)
          ? people.map((p) => this.personDto(p))
          : null,
      peopleCount: people.length,
      injuredCount: people.filter((p) => p.role === "injured").length,
      witnesses: this.witnessDtos(loaded, witnesses, names),
      files: await this.fileDtos(loaded, files),
      investigation:
        investigation && readInvestigation
          ? {
              lead: names.get(investigation.leadId) ?? null,
              members: members.flatMap((m) => {
                const person = names.get(m);
                return person ? [person] : [];
              }),
              dueOn: investigation.dueOn,
              overdueDays:
                row.status === "under_investigation" &&
                investigation.dueOn < today
                  ? daysBetween(investigation.dueOn, today)
                  : 0,
              instructions: investigation.instructions,
              sequenceOfEvents: investigation.sequenceOfEvents,
              lessonsLearned: investigation.lessonsLearned,
              assignedAt: investigation.assignedAt.getTime(),
              completedAt: investigation.completedAt?.getTime() ?? null,
              causes: causes.map((c) => {
                const category = c.categoryId
                  ? causeCategoryById.get(c.categoryId)
                  : undefined;
                return {
                  id: c.id,
                  kind: c.kind,
                  categoryId: c.categoryId,
                  categoryEn: category?.nameEn ?? null,
                  categoryAr: category?.nameAr ?? null,
                  description: c.description,
                  whys: c.whys,
                };
              }),
              version: investigation.version,
            }
          : null,
      recommendations: readInvestigation
        ? await this.recommendationDtos(
            row.companyId,
            project.code,
            recommendations,
          )
        : null,
      access: accessDto,
      transitions:
        open || row.status === "closed"
          ? allowedSafetyEventTransitions(row.status, facts)
          : [],
      canEditReport: this.reporterMayEdit(loaded),
      canClassify:
        open &&
        access.manage &&
        row.status === "reported" &&
        (await this.mayReview(loaded)),
      canEditInvestigation:
        open &&
        access.team &&
        row.status === "under_investigation" &&
        investigation?.completedAt === null,
      canRaiseActions:
        open &&
        (access.manage || access.lead) &&
        ["under_investigation", "corrective_action", "verification"].includes(
          row.status,
        ),
      canAddWitness: this.mayWriteWitness(loaded),
      canEditPeople:
        this.mayWritePeople(loaded) && loaded.type.family !== "hazard",
      canComment:
        !access.archived && row.voidedAt === null && row.status !== "closed",
    };
  }

  async detail(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
  ): Promise<SafetyEventDto> {
    return this.toDto(tenant, await this.load(tenant, project, principal, id));
  }

  // ---- Lists (PLT-33 tab, My reports) ----------------------------------------------------

  private teamEventIds(userId: string): SQL {
    return sql`${safetyEvent.id} in (
      select ${safetyEventInvestigation.eventId} from ${safetyEventInvestigation}
      where ${safetyEventInvestigation.leadId} = ${userId}
      union
      select i.event_id from safety_event_investigation i
      join safety_event_investigation_member m on m.investigation_id = i.id
      where m.user_id = ${userId} and m.removed_at is null
    )`;
  }

  private visibilityCondition(
    userId: string,
    granted: ReadonlySet<string>,
  ): SQL | undefined {
    if (granted.has("projects.safety_events.view")) return undefined;
    return or(eq(safetyEvent.reportedBy, userId), this.teamEventIds(userId));
  }

  async counts(
    tenant: TenantCompany,
    project: ProjectArg,
    condition: SQL | undefined,
  ): Promise<SafetyEventCountsDto> {
    const today = this.ctx.today(tenant);
    const base = and(
      eq(safetyEvent.companyId, tenant.id),
      eq(safetyEvent.projectId, project.id),
      isNull(safetyEvent.voidedAt),
      condition,
    );
    const row = await this.ctx.db
      .select({
        open: sql<number>`sum(case when ${safetyEvent.status} <> 'closed' then 1 else 0 end)`,
        criticalHigh: sql<number>`sum(case when ${safetyEvent.status} <> 'closed' and coalesce(${safetyEvent.severity}, ${safetyEvent.reportedSeverity}) in ('high','critical') then 1 else 0 end)`,
        toReview: sql<number>`sum(case when ${safetyEvent.status} = 'reported' then 1 else 0 end)`,
        verification: sql<number>`sum(case when ${safetyEvent.status} = 'verification' then 1 else 0 end)`,
      })
      .from(safetyEvent)
      .where(base)
      .get();
    const overdue = await this.ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(safetyEvent)
      .innerJoin(
        safetyEventInvestigation,
        eq(safetyEventInvestigation.eventId, safetyEvent.id),
      )
      .where(
        and(
          base,
          eq(safetyEvent.status, "under_investigation"),
          lt(safetyEventInvestigation.dueOn, today),
        ),
      )
      .get();
    return {
      open: row?.open ?? 0,
      criticalHigh: row?.criticalHigh ?? 0,
      toReview: row?.toReview ?? 0,
      overdueInvestigations: overdue?.n ?? 0,
      verification: row?.verification ?? 0,
    };
  }

  async list(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    query: SafetyEventListQuery,
  ): Promise<SafetyEventPageDto> {
    const granted = await this.ctx.projectPermissions(
      principal.userId,
      tenant.id,
      project.id,
    );
    const visibility = this.visibilityCondition(principal.userId, granted);
    const today = this.ctx.today(tenant);
    const conditions: (SQL | undefined)[] = [
      eq(safetyEvent.companyId, tenant.id),
      eq(safetyEvent.projectId, project.id),
      visibility,
    ];
    if (!query.voided) conditions.push(isNull(safetyEvent.voidedAt));
    if (query.status) conditions.push(eq(safetyEvent.status, query.status));
    switch (query.filter) {
      case "open":
        conditions.push(sql`${safetyEvent.status} <> 'closed'`);
        break;
      case "critical_high":
        conditions.push(
          sql`${safetyEvent.status} <> 'closed'`,
          sql`coalesce(${safetyEvent.severity}, ${safetyEvent.reportedSeverity}) in ('high','critical')`,
        );
        break;
      case "to_review":
        conditions.push(eq(safetyEvent.status, "reported"));
        break;
      case "verification":
        conditions.push(eq(safetyEvent.status, "verification"));
        break;
      case "overdue":
        conditions.push(
          eq(safetyEvent.status, "under_investigation"),
          sql`${safetyEvent.id} in (select event_id from safety_event_investigation where due_on < ${today})`,
        );
        break;
      case "mine":
        conditions.push(eq(safetyEvent.reportedBy, principal.userId));
        break;
      default:
        break;
    }
    if (query.type) conditions.push(eq(safetyEvent.typeId, query.type));
    if (query.family) conditions.push(eq(safetyEvent.family, query.family));
    if (query.severity)
      conditions.push(
        sql`coalesce(${safetyEvent.severity}, ${safetyEvent.reportedSeverity}) = ${query.severity}`,
      );
    if (query.place) {
      conditions.push(
        or(
          eq(safetyEvent.areaId, query.place),
          eq(safetyEvent.locationId, query.place),
          eq(safetyEvent.workZoneId, query.place),
        ),
      );
    }
    if (query.search) {
      const number = parseSafetyEventNumber(query.search);
      const like = `%${query.search.replace(/[%_]/g, "")}%`;
      conditions.push(
        number !== null
          ? or(
              eq(safetyEvent.number, number),
              sql`${safetyEvent.title} like ${like}`,
            )
          : sql`${safetyEvent.title} like ${like}`,
      );
    }
    const where = and(...conditions);
    const [rows, total] = await Promise.all([
      this.ctx.db
        .select()
        .from(safetyEvent)
        .where(where)
        .orderBy(
          sql`case when ${safetyEvent.status} = 'closed' then 1 else 0 end`,
          sql`case coalesce(${safetyEvent.severity}, ${safetyEvent.reportedSeverity}) when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
          desc(safetyEvent.occurredAt),
        )
        .limit(query.limit)
        .offset(query.offset)
        .all(),
      this.ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(safetyEvent)
        .where(where)
        .get(),
    ]);
    return {
      items: await this.summaries(
        tenant,
        rows,
        new Map([[project.id, project]]),
      ),
      total: total?.n ?? 0,
      counts: await this.counts(tenant, project, visibility),
      canReport:
        project.status !== "archived" &&
        granted.has("projects.safety_events.report"),
      canViewAll: granted.has("projects.safety_events.view"),
    };
  }

  /** PLT-33 My reports: across the user's projects. */
  async mine(
    tenant: TenantCompany,
    principal: Principal,
    query: MySafetyEventsQuery,
    projects: (
      ids: readonly string[],
    ) => Promise<Map<string, SafetyEventProject>>,
  ): Promise<MySafetyEventsPageDto> {
    const scope = async (permission: string): Promise<SQL> => {
      const access = await this.ctx.resolver.projectAccess(
        principal.userId,
        tenant.id,
        permission,
      );
      if (access.allProjects) return sql`1`;
      return access.projectIds.length > 0
        ? (inArray(safetyEvent.projectId, access.projectIds) as SQL)
        : sql`0`;
    };
    const [manageScope, closeScope] = await Promise.all([
      scope("projects.safety_events.manage"),
      scope("projects.safety_events.close"),
    ]);
    const conditionsFor = (tab: MySafetyEventTab) => {
      const common = [eq(safetyEvent.companyId, tenant.id)];
      switch (tab) {
        case "reported":
          return and(...common, eq(safetyEvent.reportedBy, principal.userId));
        case "investigating":
          return and(
            ...common,
            isNull(safetyEvent.voidedAt),
            eq(safetyEvent.status, "under_investigation"),
            this.teamEventIds(principal.userId),
          );
        case "to_review":
          return and(
            ...common,
            isNull(safetyEvent.voidedAt),
            eq(safetyEvent.status, "reported"),
            manageScope,
          );
        case "to_close":
          return and(
            ...common,
            isNull(safetyEvent.voidedAt),
            eq(safetyEvent.status, "verification"),
            closeScope,
          );
      }
    };
    const count = async (tab: MySafetyEventTab) =>
      (
        await this.ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(safetyEvent)
          .where(conditionsFor(tab))
          .get()
      )?.n ?? 0;
    const rows = await this.ctx.db
      .select()
      .from(safetyEvent)
      .where(conditionsFor(query.tab))
      .orderBy(desc(safetyEvent.occurredAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const [reported, investigating, toReview, toClose] = await Promise.all([
      count("reported"),
      count("investigating"),
      count("to_review"),
      count("to_close"),
    ]);
    const projectMap = await projects([
      ...new Set(rows.map((r) => r.projectId)),
    ]);
    const visible = rows.filter((r) => projectMap.has(r.projectId));
    const counts = {
      reported,
      investigating,
      to_review: toReview,
      to_close: toClose,
    };
    return {
      items: await this.summaries(tenant, visible, projectMap),
      total: counts[query.tab],
      counts,
    };
  }

  // ---- Report (US-040 – US-042) ----------------------------------------------------------

  async placeFields(
    tenant: Pick<TenantCompany, "id">,
    projectId: string,
    selection: PlaceSelection | null | undefined,
    areaRequired: boolean,
    allowInactiveIds: readonly string[] = [],
  ): Promise<{
    areaId: string | null;
    locationId: string | null;
    workZoneId: string | null;
  }> {
    const place = selection ?? {};
    if (areaRequired && !place.areaId) throw new PlaceRequiredError();
    const issues = await this.ctx.places.validateSelection(
      tenant.id,
      projectId,
      place,
      { allowInactiveIds },
    );
    if (issues.length > 0) {
      throw new ValidationError(
        issues.map((issue) => ({ ...issue, path: `place.${issue.path}` })),
      );
    }
    return {
      areaId: place.areaId ?? null,
      locationId: place.locationId ?? null,
      workZoneId: place.workZoneId ?? null,
    };
  }

  /** The type a report may use (O-118 window for inactive types offline). */
  async reportType(
    companyId: string,
    typeId: string,
    offline: OfflineMeta | null,
  ): Promise<SafetyEventTypeRow> {
    const type = await this.settings.findType(companyId, typeId);
    if (!type)
      throw new ValidationError([{ path: "typeId", message: "invalid" }]);
    if (!type.active) {
      const since = type.deactivatedAt?.getTime() ?? 0;
      const grace = SAFETY_EVENT_LIMITS.inactiveTypeGraceDays * DAY_MS;
      if (!offline || this.ctx.now() - since > grace)
        throw new EventTypeInactiveError();
    }
    return type;
  }

  async assertCategories(
    companyId: string,
    ids: readonly string[],
    allow: readonly string[] = [],
  ): Promise<void> {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const rows = await this.ctx.db
      .select()
      .from(safetyListItem)
      .where(
        and(
          eq(safetyListItem.companyId, companyId),
          inArray(safetyListItem.id, unique),
        ),
      )
      .all();
    const ok = rows.filter(
      (r) => r.list === "category" && (r.active || allow.includes(r.id)),
    );
    if (ok.length !== unique.length)
      throw new ValidationError([{ path: "categoryIds", message: "invalid" }]);
  }

  /** O-173: family and type rules for the people of a report. */
  async resolvePeople(
    companyId: string,
    type: SafetyEventTypeRow,
    people: readonly PersonInput[],
  ): Promise<{ input: PersonInput; name: string }[]> {
    if (people.length > SAFETY_EVENT_LIMITS.peopleMax)
      throw new PersonLimitError(SAFETY_EVENT_LIMITS.peopleMax);
    if (type.family === "hazard" && people.length > 0) {
      throw new ValidationError([{ path: "people", message: "notAllowed" }]);
    }
    for (const [index, person] of people.entries()) {
      const injuryFields = [
        person.injuryNature,
        person.bodyPart,
        person.treatment,
        person.daysLost,
      ].some((v) => v !== null && v !== undefined);
      if ((person.role === "injured" || injuryFields) && !type.injuryDetails) {
        throw new ValidationError([
          { path: `people.${String(index)}.role`, message: "notAllowed" },
        ]);
      }
    }
    const memberIds = people.flatMap((p) =>
      p.workforceMemberId ? [p.workforceMemberId] : [],
    );
    const userIds = people.flatMap((p) => (p.userId ? [p.userId] : []));
    const [members, users] = await Promise.all([
      new WorkforceDirectory(this.ctx.db).resolve(companyId, memberIds),
      userSummaries(this.ctx.db, userIds),
    ]);
    return people.map((person, index) => {
      if (person.workforceMemberId) {
        const member = members.get(person.workforceMemberId);
        if (!member)
          throw new ValidationError([
            {
              path: `people.${String(index)}.workforceMemberId`,
              message: "invalid",
            },
          ]);
        return { input: person, name: member.fullName };
      }
      if (person.userId) {
        const user = users.get(person.userId);
        if (user?.companyId !== companyId) {
          throw new ValidationError([
            { path: `people.${String(index)}.userId`, message: "invalid" },
          ]);
        }
        return { input: person, name: user.fullName };
      }
      return { input: person, name: person.name ?? "" };
    });
  }

  async resolveWitness(
    companyId: string,
    witness: WitnessInput,
    path: string,
  ): Promise<{ name: string }> {
    if (witness.workforceMemberId) {
      const member = (
        await new WorkforceDirectory(this.ctx.db).resolve(companyId, [
          witness.workforceMemberId,
        ])
      ).get(witness.workforceMemberId);
      if (!member)
        throw new ValidationError([
          { path: `${path}.workforceMemberId`, message: "invalid" },
        ]);
      return { name: member.fullName };
    }
    if (witness.userId) {
      const user = (await userSummaries(this.ctx.db, [witness.userId])).get(
        witness.userId,
      );
      if (user?.companyId !== companyId)
        throw new ValidationError([
          { path: `${path}.userId`, message: "invalid" },
        ]);
      return { name: user.fullName };
    }
    return { name: witness.name ?? "" };
  }

  personValues(
    companyId: string,
    eventId: string,
    entry: { input: PersonInput; name: string },
    by: string,
    now: Date,
  ): typeof safetyEventPerson.$inferInsert {
    const { input } = entry;
    const injured = input.role === "injured";
    return {
      id: generateId(),
      companyId,
      eventId,
      workforceMemberId: input.workforceMemberId ?? null,
      userId: input.userId ?? null,
      name: entry.name,
      role: input.role,
      injuryNature: injured ? (input.injuryNature ?? null) : null,
      bodyPart: injured ? (input.bodyPart ?? null) : null,
      treatment: injured ? (input.treatment ?? null) : null,
      daysLost: injured ? (input.daysLost ?? null) : null,
      detail: input.detail ?? null,
      removedAt: null,
      removedBy: null,
      createdAt: now,
      createdBy: by,
      updatedAt: now,
      updatedBy: by,
    };
  }

  /** US-040 – US-042 family rules on the report's own fields. */
  private checkFamilyFields(
    type: SafetyEventTypeRow,
    fields: Pick<ReportInput, "potentialOutcome" | "environmentDetails">,
    people: readonly PersonInput[],
  ): void {
    if (type.family === "near_miss") {
      if (
        !fields.potentialOutcome ||
        fields.potentialOutcome.length < SAFETY_EVENT_LIMITS.potentialOutcomeMin
      ) {
        throw new ValidationError([
          { path: "potentialOutcome", message: "required" },
        ]);
      }
    }
    if (
      type.family === "incident" &&
      type.injuryDetails &&
      !people.some((p) => p.role === "injured")
    ) {
      throw new ValidationError([
        { path: "people", message: "injuredRequired" },
      ]);
    }
    if (type.seedKey === "environmental" && !fields.environmentDetails) {
      throw new ValidationError([
        { path: "environmentDetails", message: "required" },
      ]);
    }
  }

  async create(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    input: ReportInput,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<CreateResult> {
    if (project.status === "archived") throw new ProjectArchivedError();
    const granted = await this.ctx.projectPermissions(
      principal.userId,
      tenant.id,
      project.id,
    );
    if (!granted.has("projects.safety_events.report"))
      throw new ForbiddenError();
    if (input.id) {
      const existing = await this.ctx.db
        .select()
        .from(safetyEvent)
        .where(eq(safetyEvent.id, input.id))
        .get();
      if (existing) {
        if (
          existing.companyId === tenant.id &&
          existing.createdBy === principal.userId
        ) {
          return {
            dto: await this.detail(tenant, project, principal, existing.id),
            replayed: true,
          };
        }
        throw new RecordIdTakenError();
      }
    }
    // O-181: accepting projects and On Hold projects take reports.
    if (!["mobilization", "active", "on_hold"].includes(project.status)) {
      throw new ProjectNotAcceptingRecordsError(project.status);
    }
    await this.settings.ensureSeeded(tenant.id);
    const now = this.ctx.now();
    const capturedAt = offline?.capturedAt ?? now;
    const type = await this.reportType(tenant.id, input.typeId, offline);
    const timeIssue = occurredAtIssue(input.occurredAt, capturedAt);
    if (timeIssue) throw new EventTimeInvalidError(timeIssue);
    if (!severityAtLeast(input.reportedSeverity, type.minSeverity)) {
      throw new SeverityBelowMinimumError(type.minSeverity ?? "low");
    }
    await this.assertCategories(tenant.id, input.categoryIds);
    this.checkFamilyFields(type, input, input.people);
    const people = await this.resolvePeople(tenant.id, type, input.people);
    if (input.witnesses.length > SAFETY_EVENT_LIMITS.witnessesMax) {
      throw new WitnessLimitError(SAFETY_EVENT_LIMITS.witnessesMax);
    }
    const witnesses = await Promise.all(
      input.witnesses.map(async (w, index) => ({
        input: w,
        ...(await this.resolveWitness(
          tenant.id,
          w,
          `witnesses.${String(index)}`,
        )),
      })),
    );
    let followUpOf: string | null = null;
    if (input.followUpOf) {
      const previous = await this.findRow(
        tenant.id,
        project.id,
        input.followUpOf,
      );
      if (!previous)
        throw new ValidationError([{ path: "followUpOf", message: "invalid" }]);
      followUpOf = previous.id;
    }
    const place = await this.placeFields(
      tenant,
      project.id,
      input.place,
      type.areaRequired,
    );
    const id = input.id ?? generateId();
    const at = new Date(now);
    try {
      await withRecordNumber(SAFETY_EVENT_NUMBER_INDEX, async () => {
        const number = await this.ctx.numbers.peek(project.id, "safety_event");
        const row: SafetyEventRow = {
          id,
          companyId: tenant.id,
          projectId: project.id,
          number,
          typeId: type.id,
          family: type.family,
          title: input.title,
          description: input.description,
          occurredAt: new Date(input.occurredAt),
          reportedLate: reportedLate(input.occurredAt, capturedAt),
          ...place,
          latitude: input.location?.latitude ?? null,
          longitude: input.location?.longitude ?? null,
          locationAccuracyM: input.location?.accuracy ?? null,
          reportedBy: principal.userId,
          reportedSeverity: input.reportedSeverity,
          severity: null,
          immediateAction: input.immediateAction ?? null,
          potentialOutcome:
            type.family === "near_miss"
              ? (input.potentialOutcome ?? null)
              : null,
          damageDetails:
            type.family === "incident" ? (input.damageDetails ?? null) : null,
          environmentDetails:
            type.family === "incident"
              ? (input.environmentDetails ?? null)
              : null,
          riskMatrixVersion: null,
          riskLikelihood: null,
          riskConsequence: null,
          riskScore: null,
          riskBand: null,
          riskBandLabel: null,
          status: "reported",
          investigationRequired: type.investigation === "required",
          reviewStartedAt: null,
          reviewStartedBy: null,
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: null,
          selfReviewed: false,
          voidedAt: null,
          voidedBy: null,
          voidKind: null,
          voidReason: null,
          duplicateOf: null,
          closedAt: null,
          closedBy: null,
          closureKind: null,
          closureSummary: null,
          followUpOf,
          offline: offline !== null,
          deviceId: offline?.deviceId ?? null,
          capturedAt: offline ? new Date(capturedAt) : null,
          receivedAt: new Date(offline?.receivedAt ?? now),
          version: 1,
          createdAt: at,
          createdBy: principal.userId,
          updatedAt: at,
          updatedBy: principal.userId,
        };
        const statements: Statement[] = [
          this.ctx.numbers.claim(project.id, "safety_event", number),
          this.ctx.db.insert(safetyEvent).values(row),
          ...[...new Set(input.categoryIds)].map((categoryId) =>
            this.ctx.db
              .insert(safetyEventCategoryLink)
              .values({ eventId: id, categoryId, companyId: tenant.id }),
          ),
          ...people.map((p) =>
            this.ctx.db
              .insert(safetyEventPerson)
              .values(
                this.personValues(tenant.id, id, p, principal.userId, at),
              ),
          ),
          ...witnesses.map((w) =>
            this.ctx.db.insert(safetyEventWitness).values({
              id: generateId(),
              companyId: tenant.id,
              eventId: id,
              workforceMemberId: w.input.workforceMemberId ?? null,
              userId: w.input.userId ?? null,
              name: w.name,
              company: w.input.company ?? null,
              contact: w.input.contact ?? null,
              statement: null,
              statementOn: null,
              takenBy: null,
              removedAt: null,
              removedBy: null,
              removeReason: null,
              version: 1,
              createdAt: at,
              createdBy: principal.userId,
              updatedAt: at,
              updatedBy: principal.userId,
            }),
          ),
          ...this.ctx.record(principal.userId, row, project, type, {
            audit: "safety_event.reported",
            activity: "safety_event.reported",
            newValue: {
              reference: safetyEventReference(project.code, number),
              typeId: type.id,
              severity: row.reportedSeverity,
              people: people.length,
              witnesses: witnesses.length,
              ...offlineAudit(offline),
            },
            snapshot: { severity: row.reportedSeverity },
          }),
          ...(await this.severityNotifications(
            tenant,
            row,
            project,
            type,
            null,
            row.reportedSeverity,
            principal.userId,
          )),
        ];
        if (followUpOf) {
          statements.push(
            this.ctx.audit.entry({
              action: "safety_event.follow_up_reported",
              actorUserId: principal.userId,
              companyId: tenant.id,
              projectId: project.id,
              entityType: "safety_event",
              entityId: followUpOf,
              newValue: { followUp: id },
            }),
          );
        }
        if (claim) {
          statements.push(
            this.ctx.keys.record(claim, {
              companyId: tenant.id,
              userId: principal.userId,
              resourceType: "safety_event",
              resourceId: id,
              statusCode: 201,
            }),
          );
        }
        await new UnitOfWork(this.ctx.db).add(...statements).commit();
      });
    } catch (error) {
      if (isUnique(error, "safety_event.id")) throw new RecordIdTakenError();
      throw error;
    }
    return {
      dto: await this.detail(tenant, project, principal, id),
      replayed: false,
    };
  }

  /** Managers of the project who may review (company-wide roles only if none, O-175). */
  async reviewers(
    companyId: string,
    projectId: string,
    exclude: string | null,
  ): Promise<string[]> {
    const onProject: string[] = [];
    for (const entry of await this.ctx.audience.projectRoles(
      companyId,
      projectId,
    )) {
      if (entry.userId === exclude) continue;
      if (
        (await this.ctx.resolver.roleGrants(companyId, entry.roleCode)).has(
          "projects.safety_events.manage",
        )
      ) {
        onProject.push(entry.userId);
      }
    }
    if (onProject.length > 0) return [...new Set(onProject)];
    const all = await this.ctx.audience.projectPermissionHolders(
      companyId,
      projectId,
      "projects.safety_events.manage",
      this.ctx.resolver,
    );
    return all.filter((id) => id !== exclude);
  }

  /** O-175: reported / high / critical by severity; `previous` set when a review raises it. */
  async severityNotifications(
    tenant: Pick<TenantCompany, "id">,
    row: SafetyEventRow,
    project: SafetyEventProject,
    type: SafetyEventTypeRow,
    previous: string | null,
    severity: string,
    actorUserId: string,
  ): Promise<Statement[]> {
    const critical = severity === "critical" || type.seedKey === "fatality";
    const high = critical || severity === "high";
    if (previous !== null) {
      // A raised severity notifies only when it crosses into High or Critical.
      const wasCritical = previous === "critical";
      const wasHigh = wasCritical || previous === "high";
      if (!(critical && !wasCritical) && !(high && !wasHigh)) return [];
    }
    const recipients = new Set(
      await this.reviewers(tenant.id, project.id, null),
    );
    if (high) {
      for (const id of await this.ctx.audience.companyRoleHolders(tenant.id, [
        "hse_director",
        "hse_manager",
      ])) {
        recipients.add(id);
      }
    }
    if (critical) {
      for (const id of await this.ctx.audience.companyRoleHolders(tenant.id, [
        "company_administrator",
      ])) {
        recipients.add(id);
      }
    }
    const typeName = critical
      ? "safety_event.critical_reported"
      : high
        ? "safety_event.high_reported"
        : "safety_event.reported";
    const { investigation, members } = await this.investigationOf(row.id);
    return this.ctx.notify(
      typeName,
      row,
      project,
      type,
      actorUserId,
      recipients,
      this.canSee({ row, investigation, members }),
      critical ? { urgent: true } : {},
    );
  }

  // ---- Reporter edits (US-040 FR-4, offline) ---------------------------------------------

  async update(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    input: UpdateInput,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<SafetyEventDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    if (!loaded.access.reporter) throw new NotReporterError();
    if (!this.reporterMayEdit(loaded)) {
      throw new SafetyEventLockedError(
        "A reviewer has started reviewing this report. Add what you wanted to say as a comment.",
      );
    }
    const { baseVersion, ...values } = input;
    const { row } = loaded;
    if (baseVersion !== undefined && baseVersion !== row.version) {
      throw await this.conflict(
        loaded,
        principal,
        baseVersion,
        values,
        offline,
      );
    }
    const prepared = await this.prepareUpdate(
      tenant,
      loaded,
      principal,
      values,
      row.version,
      claim,
      offline,
    );
    try {
      await new UnitOfWork(this.ctx.db).add(...prepared.statements).commit();
    } catch (error) {
      if (!isVersionGuardFailure(error)) throw error;
      const latest = await this.load(tenant, project, principal, id);
      if (!this.reporterMayEdit(latest)) throw new SafetyEventLockedError();
      throw await this.conflict(
        latest,
        principal,
        baseVersion ?? row.version,
        values,
        offline,
      );
    }
    return this.detail(tenant, project, principal, id);
  }

  /** The reporter's change as statements, guarded on `expectVersion` (also for conflict resolution). */
  async prepareUpdate(
    tenant: Pick<TenantCompany, "id">,
    loaded: Loaded,
    principal: Principal,
    values: Omit<UpdateInput, "baseVersion">,
    expectVersion: number,
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<PreparedUpdate> {
    const { row, project } = loaded;
    let type = loaded.type;
    const next: Partial<SafetyEventRow> = {};
    if (values.typeId !== undefined && values.typeId !== row.typeId) {
      type = await this.reportType(tenant.id, values.typeId, offline);
      if (type.family !== row.family)
        throw new ValidationError([
          { path: "typeId", message: "familyChange" },
        ]);
      next.typeId = type.id;
      next.investigationRequired = type.investigation === "required";
    }
    if (values.title !== undefined) next.title = values.title;
    if (values.description !== undefined) next.description = values.description;
    if (values.occurredAt !== undefined) {
      const reference = offline?.capturedAt ?? this.ctx.now();
      const issue = occurredAtIssue(values.occurredAt, reference);
      if (issue) throw new EventTimeInvalidError(issue);
      next.occurredAt = new Date(values.occurredAt);
      next.reportedLate = reportedLate(
        values.occurredAt,
        row.capturedAt?.getTime() ?? row.receivedAt.getTime(),
      );
    }
    const severity = values.reportedSeverity ?? row.reportedSeverity;
    if (!severityAtLeast(severity, type.minSeverity))
      throw new SeverityBelowMinimumError(type.minSeverity ?? "low");
    if (values.reportedSeverity !== undefined)
      next.reportedSeverity = values.reportedSeverity;
    if (values.immediateAction !== undefined)
      next.immediateAction = values.immediateAction;
    if (values.potentialOutcome !== undefined && row.family === "near_miss") {
      if (
        !values.potentialOutcome ||
        values.potentialOutcome.length < SAFETY_EVENT_LIMITS.potentialOutcomeMin
      ) {
        throw new ValidationError([
          { path: "potentialOutcome", message: "required" },
        ]);
      }
      next.potentialOutcome = values.potentialOutcome;
    }
    if (values.damageDetails !== undefined && row.family === "incident")
      next.damageDetails = values.damageDetails;
    if (values.environmentDetails !== undefined && row.family === "incident") {
      next.environmentDetails = values.environmentDetails;
    }
    if (values.place !== undefined || values.placeId !== undefined) {
      let selection = values.place;
      if (values.placeId !== undefined) {
        const resolved = values.placeId
          ? await this.ctx.places.resolve(tenant.id, project.id, values.placeId)
          : undefined;
        if (values.placeId && !resolved)
          throw new ValidationError([
            { path: "placeId", message: "placeInvalid" },
          ]);
        selection = resolved
          ? {
              areaId: resolved.areaId,
              locationId: resolved.locationId,
              workZoneId: resolved.workZoneId,
            }
          : null;
      }
      Object.assign(
        next,
        await this.placeFields(
          tenant,
          project.id,
          selection,
          type.areaRequired,
          [row.areaId, row.locationId, row.workZoneId].filter(
            (v): v is string => v !== null,
          ),
        ),
      );
    }
    if (values.location !== undefined) {
      next.latitude = values.location?.latitude ?? null;
      next.longitude = values.location?.longitude ?? null;
      next.locationAccuracyM = values.location?.accuracy ?? null;
    }
    const statements: Statement[] = [];
    if (values.categoryIds !== undefined) {
      const current = await this.categoryIds(row.id);
      await this.assertCategories(tenant.id, values.categoryIds, current);
      const wanted = new Set(values.categoryIds);
      for (const old of current) {
        if (!wanted.has(old)) {
          statements.push(
            this.ctx.db
              .delete(safetyEventCategoryLink)
              .where(
                and(
                  eq(safetyEventCategoryLink.eventId, row.id),
                  eq(safetyEventCategoryLink.categoryId, old),
                ),
              ),
          );
        }
      }
      for (const categoryId of wanted) {
        if (!current.includes(categoryId)) {
          statements.push(
            this.ctx.db
              .insert(safetyEventCategoryLink)
              .values({
                eventId: row.id,
                categoryId,
                companyId: row.companyId,
              }),
          );
        }
      }
    }
    const now = new Date(this.ctx.now());
    const version = expectVersion + 1;
    const changed = Object.keys(next);
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
    statements.unshift(
      this.ctx.db
        .update(safetyEvent)
        .set({ ...next, version, updatedAt: now, updatedBy: principal.userId })
        .where(
          and(
            eq(safetyEvent.id, row.id),
            eq(safetyEvent.version, expectVersion),
            eq(safetyEvent.status, "reported"),
            isNull(safetyEvent.reviewStartedAt),
          ),
        ),
      this.guard(row.id, version, now, principal.userId),
    );
    statements.push(
      ...this.ctx.record(principal.userId, after, project, type, {
        audit: "safety_event.updated",
        activity: "safety_event.updated",
        oldValue: before,
        newValue: {
          ...next,
          ...(values.categoryIds ? { categoryIds: values.categoryIds } : {}),
          ...offlineAudit(offline),
        },
        changes: { before, after: next },
      }),
    );
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
    return {
      statements,
      record: {
        id: row.id,
        version,
        ...this.headerValues(after, values.categoryIds ?? null),
      },
    };
  }

  headerValues(
    row: SafetyEventRow,
    categoryIds: readonly string[] | null,
  ): Record<string, unknown> {
    return {
      title: row.title,
      description: row.description,
      occurredAt: row.occurredAt.getTime(),
      placeId: placeOf(row),
      reportedSeverity: row.reportedSeverity,
      immediateAction: row.immediateAction,
      typeId: row.typeId,
      ...(categoryIds ? { categoryIds } : {}),
    };
  }

  async snapshot(
    row: SafetyEventRow,
    projectCode: string,
  ): Promise<SyncSnapshot> {
    return {
      version: row.version,
      values: this.headerValues(row, await this.categoryIds(row.id)),
      projectId: row.projectId,
      projectCode,
      label: `Safety event ${safetyEventReference(projectCode, row.number) ?? ""}`,
      changedBy: row.updatedBy,
    };
  }

  private async conflict(
    loaded: Loaded,
    principal: Principal,
    baseVersion: number,
    values: Record<string, unknown>,
    offline: OfflineMeta | null,
  ): Promise<SyncConflictError> {
    if (!offline) return new SyncConflictError(null, loaded.row.version);
    return new SyncConflictService(
      this.ctx.db,
      this.ctx.deps.meta,
      this.ctx.deps.clock,
    ).detect({
      companyId: loaded.row.companyId,
      userId: principal.userId,
      entity: safetyEventSyncEntity,
      entityId: loaded.row.id,
      baseVersion,
      clientPayload: { ...values },
      snapshot: await this.snapshot(loaded.row, loaded.project.code),
    });
  }

  /**
   * Fails the batch unless this request's own write is in place: two writers that both read
   * version n would both find n + 1, so the writer's time and user are checked too.
   */
  guard(id: string, version: number, at?: Date, by?: string): Statement {
    const mine =
      at && by
        ? sql` and ${safetyEvent.updatedAt} = ${at.getTime()} and ${safetyEvent.updatedBy} = ${by}`
        : sql``;
    return this.ctx.db
      .select({
        ok: sql<number>`case when ${safetyEvent.version} = ${version}${mine} then 1 else json('safety event changed') end`,
      })
      .from(safetyEvent)
      .where(eq(safetyEvent.id, id));
  }

  async commitGuarded(
    row: SafetyEventRow,
    statements: Statement[],
  ): Promise<void> {
    try {
      await new UnitOfWork(this.ctx.db).add(...statements).commit();
    } catch (error) {
      const text = String(
        (error as { message?: unknown } | null)?.message ?? error,
      );
      if (!text.includes(GUARD)) throw error;
      const current = await this.ctx.db
        .select({ status: safetyEvent.status })
        .from(safetyEvent)
        .where(eq(safetyEvent.id, row.id))
        .get();
      throw new SafetyEventTransitionError(current?.status ?? row.status);
    }
  }

  // ---- Files (US-040, US-042, US-045) ----------------------------------------------------

  async addFile(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    file: File,
    options: { sensitive: boolean; witnessId: string | null },
    claim: IdempotencyClaim | undefined,
    offline: OfflineMeta | null,
  ): Promise<SafetyEventFileDto> {
    const loaded = await this.load(tenant, project, principal, id);
    const { row, access } = loaded;
    if (access.archived) throw new ProjectArchivedError();
    if (row.voidedAt !== null || row.status === "closed")
      throw new SafetyEventLockedError();
    const capturedAt = offline?.capturedAt ?? this.ctx.now();
    if (options.sensitive) {
      if (offline)
        throw new ValidationError([{ path: "file", message: "onlineOnly" }]);
      if (!(access.team || (access.manage && access.sensitive)))
        throw new ForbiddenError();
      if (
        !(
          SAFETY_EVENT_FILE_RULES.sensitiveContentTypes as readonly string[]
        ).includes(file.type)
      ) {
        throw new ValidationError([{ path: "file", message: "type" }]);
      }
    } else {
      // The reporter until review starts (a photo captured before it is still accepted).
      const reporterOk =
        access.reporter &&
        row.status === "reported" &&
        (row.reviewStartedAt === null ||
          capturedAt <= row.reviewStartedAt.getTime());
      if (!reporterOk && !access.team && !access.manage) {
        if (access.reporter) {
          throw new SafetyEventLockedError(
            "A reviewer has started reviewing this report. Add what you wanted to say as a comment.",
          );
        }
        throw new ForbiddenError();
      }
    }
    if (options.witnessId) {
      const witness = (await this.witnessRows(id)).find(
        (w) => w.id === options.witnessId,
      );
      if (!witness)
        throw new ValidationError([{ path: "witnessId", message: "invalid" }]);
    }
    const files = await this.fileRows(id);
    if (files.length >= SAFETY_EVENT_LIMITS.filesMax)
      throw new SafetyEventFileLimitError(SAFETY_EVENT_LIMITS.filesMax);
    if (
      options.sensitive &&
      files.filter((f) => f.sensitive).length >=
        SAFETY_EVENT_LIMITS.sensitiveFilesMax
    ) {
      throw new SafetyEventFileLimitError(
        SAFETY_EVENT_LIMITS.sensitiveFilesMax,
      );
    }
    if (
      !options.sensitive &&
      row.status === "reported" &&
      access.reporter &&
      files.filter((f) => f.createdBy === principal.userId && !f.sensitive)
        .length >= SAFETY_EVENT_LIMITS.reportFilesMax
    ) {
      throw new SafetyEventFileLimitError(SAFETY_EVENT_LIMITS.reportFilesMax);
    }
    const stored = await this.ctx.files.store({
      companyId: tenant.id,
      category: options.sensitive
        ? "safety_event_sensitive"
        : "safety_event_evidence",
      uploadedBy: principal.userId,
      file,
      beforeWrite: this.ctx.storageCheck(tenant.id),
    });
    const now = new Date(this.ctx.now());
    const linkId = generateId();
    const statements: Statement[] = [
      stored.statement,
      this.ctx.db.insert(safetyEventFile).values({
        id: linkId,
        companyId: tenant.id,
        eventId: id,
        fileId: stored.row.id,
        sensitive: options.sensitive,
        witnessId: options.witnessId,
        capturedAt: new Date(capturedAt),
        removedAt: null,
        removedBy: null,
        createdAt: now,
        createdBy: principal.userId,
      }),
      ...this.ctx.record(principal.userId, row, project, loaded.type, {
        audit: "safety_event.file_added",
        activity: "safety_event.file_added",
        newValue: {
          sensitive: options.sensitive,
          size: stored.row.sizeBytes,
          type: stored.row.contentType,
          ...offlineAudit(offline),
        },
        snapshot: options.sensitive ? {} : { fileName: stored.row.fileName },
        sensitive: options.sensitive,
      }),
    ];
    if (claim) {
      statements.push(
        this.ctx.keys.record(claim, {
          companyId: tenant.id,
          userId: principal.userId,
          resourceType: "safety_event_file",
          resourceId: linkId,
          statusCode: 201,
        }),
      );
    }
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    return this.fileDto(tenant, project, principal, id, linkId);
  }

  async fileDto(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    linkId: string,
  ): Promise<SafetyEventFileDto> {
    const loaded = await this.load(tenant, project, principal, id);
    const found = (await this.fileDtos(loaded, await this.fileRows(id))).find(
      (f) => f.id === linkId,
    );
    if (!found) throw new NotFoundError();
    return found;
  }

  async removeFile(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    linkId: string,
  ): Promise<void> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    const link = (await this.fileRows(id)).find((f) => f.id === linkId);
    if (!link) throw new NotFoundError();
    if (
      !this.reporterMayEdit(loaded) ||
      link.createdBy !== principal.userId ||
      link.sensitive
    ) {
      throw new SafetyEventLockedError();
    }
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(safetyEventFile)
          .set({
            removedAt: new Date(this.ctx.now()),
            removedBy: principal.userId,
          })
          .where(eq(safetyEventFile.id, linkId)),
        ...this.ctx.record(
          principal.userId,
          loaded.row,
          loaded.project,
          loaded.type,
          {
            audit: "safety_event.file_removed",
            activity: "safety_event.file_removed",
            oldValue: { fileId: link.fileId },
          },
        ),
      )
      .commit();
  }

  async openFile(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    linkId: string,
  ): Promise<{ opened: OpenedFile; sensitive: boolean } | null> {
    const loaded = await this.load(tenant, project, principal, id);
    const link = await this.ctx.db
      .select()
      .from(safetyEventFile)
      .where(
        and(eq(safetyEventFile.eventId, id), eq(safetyEventFile.id, linkId)),
      )
      .get();
    if (!link || link.removedAt !== null) return null;
    if (link.sensitive && !loaded.access.sensitive) return null;
    const opened = await this.ctx.files.open(link.fileId, tenant.id);
    return opened ? { opened, sensitive: link.sensitive } : null;
  }

  // ---- People (US-041, US-042) -----------------------------------------------------------

  async setPeople(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    people: readonly PersonInput[],
  ): Promise<SafetyPersonDto[]> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    if (!this.mayWritePeople(loaded)) throw new ForbiddenError();
    const resolved = await this.resolvePeople(tenant.id, loaded.type, people);
    if (
      loaded.type.injuryDetails &&
      !people.some((p) => p.role === "injured")
    ) {
      throw new ValidationError([
        { path: "people", message: "injuredRequired" },
      ]);
    }
    const current = await this.personRows(id);
    const now = new Date(this.ctx.now());
    const keep = new Set(people.flatMap((p) => (p.id ? [p.id] : [])));
    const statements: Statement[] = [];
    for (const row of current) {
      if (!keep.has(row.id)) {
        statements.push(
          this.ctx.db
            .update(safetyEventPerson)
            .set({ removedAt: now, removedBy: principal.userId })
            .where(eq(safetyEventPerson.id, row.id)),
        );
      }
    }
    for (const entry of resolved) {
      const existing = entry.input.id
        ? current.find((r) => r.id === entry.input.id)
        : undefined;
      const values = this.personValues(
        tenant.id,
        id,
        entry,
        principal.userId,
        now,
      );
      if (existing) {
        const {
          id: _ignored,
          createdAt: _c,
          createdBy: _b,
          ...changes
        } = values;
        statements.push(
          this.ctx.db
            .update(safetyEventPerson)
            .set(changes)
            .where(eq(safetyEventPerson.id, existing.id)),
        );
      } else {
        statements.push(this.ctx.db.insert(safetyEventPerson).values(values));
      }
    }
    statements.push(
      ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
        audit: "safety_event.person_changed",
        activity: "safety_event.person_changed",
        newValue: {
          injured: people.filter((p) => p.role === "injured").length,
          involved: people.filter((p) => p.role === "involved").length,
        },
        snapshot: { count: people.length },
        sensitive: true,
      }),
    );
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    return (await this.personRows(id)).map((r) => this.personDto(r));
  }

  // ---- Witnesses (US-045) ----------------------------------------------------------------

  async addWitness(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    input: WitnessInput,
  ): Promise<SafetyWitnessDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    if (!this.mayWriteWitness(loaded)) throw new ForbiddenError();
    const current = await this.witnessRows(id);
    if (current.length >= SAFETY_EVENT_LIMITS.witnessesMax)
      throw new WitnessLimitError(SAFETY_EVENT_LIMITS.witnessesMax);
    const duplicate = current.some(
      (w) =>
        (input.workforceMemberId &&
          w.workforceMemberId === input.workforceMemberId) ||
        (input.userId && w.userId === input.userId),
    );
    if (duplicate)
      throw new ValidationError([{ path: "name", message: "duplicate" }]);
    const { name } = await this.resolveWitness(tenant.id, input, "witness");
    const now = new Date(this.ctx.now());
    const witnessId = generateId();
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db.insert(safetyEventWitness).values({
          id: witnessId,
          companyId: tenant.id,
          eventId: id,
          workforceMemberId: input.workforceMemberId ?? null,
          userId: input.userId ?? null,
          name,
          company: input.company ?? null,
          contact: input.contact ?? null,
          statement: null,
          statementOn: null,
          takenBy: null,
          removedAt: null,
          removedBy: null,
          removeReason: null,
          version: 1,
          createdAt: now,
          createdBy: principal.userId,
          updatedAt: now,
          updatedBy: principal.userId,
        }),
        ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
          audit: "safety_event.witness_changed",
          activity: "safety_event.witness_changed",
          newValue: { witnessId, change: "added" },
          snapshot: { status: "added" },
        }),
      )
      .commit();
    return this.witnessDto(tenant, project, principal, id, witnessId);
  }

  private async witnessDto(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    witnessId: string,
  ): Promise<SafetyWitnessDto> {
    const loaded = await this.load(tenant, project, principal, id);
    const rows = await this.witnessRows(id);
    const names = await this.people(rows.map((r) => r.takenBy));
    const found = this.witnessDtos(loaded, rows, names).find(
      (w) => w.id === witnessId,
    );
    if (!found) throw new NotFoundError();
    return found;
  }

  async updateWitness(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    witnessId: string,
    input: WitnessUpdateInput,
  ): Promise<SafetyWitnessDto> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    if (!this.mayWriteWitness(loaded)) throw new ForbiddenError();
    const witness = (await this.witnessRows(id)).find(
      (w) => w.id === witnessId,
    );
    if (!witness) throw new NotFoundError();
    if (
      input.baseVersion !== undefined &&
      input.baseVersion !== witness.version
    ) {
      throw new SyncConflictError(null, witness.version);
    }
    const next: Partial<SafetyEventWitnessRow> = {};
    if (input.company !== undefined) next.company = input.company;
    if (input.contact !== undefined) next.contact = input.contact;
    const statementChange =
      input.statement !== undefined || input.statementOn !== undefined;
    if (statementChange) {
      const team = loaded.access.team || loaded.access.manage;
      if (!team) throw new ForbiddenError();
      if (loaded.investigation?.completedAt) throw new SafetyEventLockedError();
      if (witness.statement !== null && witness.takenBy !== principal.userId)
        throw new ForbiddenError();
      if (input.statementOn) {
        const today = this.ctx.today(tenant);
        const occurredOn = new Date(loaded.row.occurredAt)
          .toISOString()
          .slice(0, 10);
        if (input.statementOn > today || input.statementOn < occurredOn) {
          throw new ValidationError([
            { path: "statementOn", message: "invalidDate" },
          ]);
        }
      }
      if (input.statement !== undefined) {
        next.statement = input.statement;
        next.takenBy = input.statement === null ? null : principal.userId;
      }
      if (input.statementOn !== undefined) next.statementOn = input.statementOn;
      else if (input.statement && !witness.statementOn)
        next.statementOn = this.ctx.today(tenant);
    }
    const now = new Date(this.ctx.now());
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(safetyEventWitness)
          .set({
            ...next,
            version: witness.version + 1,
            updatedAt: now,
            updatedBy: principal.userId,
          })
          .where(
            and(
              eq(safetyEventWitness.id, witnessId),
              eq(safetyEventWitness.version, witness.version),
            ),
          ),
        ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
          audit: "safety_event.witness_changed",
          activity: "safety_event.witness_changed",
          oldValue: statementChange
            ? { statementLength: witness.statement?.length ?? 0 }
            : null,
          newValue: {
            witnessId,
            change: statementChange
              ? witness.statement === null
                ? "statement_recorded"
                : "statement_edited"
              : "updated",
          },
          changes: statementChange
            ? {
                before: { statement: witness.statement },
                after: { statement: next.statement ?? witness.statement },
              }
            : null,
          snapshot: { status: statementChange ? "statement" : "updated" },
          sensitive: statementChange,
        }),
      )
      .commit();
    return this.witnessDto(tenant, project, principal, id, witnessId);
  }

  async removeWitness(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    witnessId: string,
    reason: string,
  ): Promise<void> {
    const loaded = await this.load(tenant, project, principal, id);
    this.assertWritable(loaded);
    if (!(
      loaded.access.team ||
      loaded.access.manage ||
      this.reporterMayEdit(loaded)
    ))
      throw new ForbiddenError();
    const witness = (await this.witnessRows(id)).find(
      (w) => w.id === witnessId,
    );
    if (!witness) throw new NotFoundError();
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(safetyEventWitness)
          .set({
            removedAt: new Date(this.ctx.now()),
            removedBy: principal.userId,
            removeReason: reason,
          })
          .where(eq(safetyEventWitness.id, witnessId)),
        ...this.ctx.record(principal.userId, loaded.row, project, loaded.type, {
          audit: "safety_event.witness_changed",
          activity: "safety_event.witness_changed",
          newValue: { witnessId, change: "removed", reason },
          snapshot: { status: "removed", reason: reason.slice(0, 200) },
        }),
      )
      .commit();
  }

  // ---- History and comments ---------------------------------------------------------------

  async history(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    before: string | undefined,
  ): Promise<TimelinePageDto> {
    const { row, access } = await this.load(tenant, project, principal, id);
    const { rows, next } = await this.ctx.activity.listForEntity(
      tenant.id,
      { type: "safety_event", id: row.id },
      { before: parseActivityCursor(before), limit: 50 },
    );
    const actors = await userSummaries(
      this.ctx.db,
      rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])),
    );
    const readInvestigation = mayReadInvestigation(access);
    const items: ActivityEntryDto[] = [];
    for (const entry of rows) {
      const snapshot = entry.snapshot
        ? (JSON.parse(entry.snapshot) as ActivityEntryDto["snapshot"])
        : {};
      if (snapshot.sensitive && !access.sensitive) continue;
      if (
        !readInvestigation &&
        entry.action.startsWith("safety_event.investigation_updated")
      )
        continue;
      const actor = entry.actorUserId
        ? actors.get(entry.actorUserId)
        : undefined;
      const name = entry.action as ActivityEntryDto["action"];
      items.push({
        id: entry.id,
        action: name,
        group: ACTIVITY_ACTIONS[name],
        actorName: actor?.fullName ?? null,
        actorFormer: actor
          ? actor.former || actor.companyId !== tenant.id
          : false,
        occurredAt: entry.occurredAt.getTime(),
        changes:
          entry.changes && (access.sensitive || !snapshot.sensitive)
            ? (JSON.parse(entry.changes) as ActivityEntryDto["changes"])
            : null,
        snapshot,
      });
    }
    return { nextBefore: next, items };
  }

  private commentTarget(loaded: Loaded): CommentTarget {
    const { row } = loaded;
    return {
      companyId: row.companyId,
      projectId: row.projectId,
      entityType: "safety_event",
      entityId: row.id,
      locked:
        row.status === "closed" ||
        row.voidedAt !== null ||
        loaded.access.archived,
    };
  }

  async comments(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    before: string | undefined,
  ): Promise<CommentPageDto> {
    const loaded = await this.load(tenant, project, principal, id);
    const target = this.commentTarget(loaded);
    const { rows, nextBefore } = await this.ctx.comments.list(
      target,
      parseCommentCursor(before),
    );
    const authors = [...new Set(rows.map((r) => r.authorId))];
    const names = await userSummaries(this.ctx.db, authors);
    const see = this.canSee(loaded);
    const access = new Set<string>();
    for (const author of authors) if (await see(author)) access.add(author);
    return {
      comments: rows.map((r): CommentDto => ({
        id: r.id,
        author: {
          id: r.authorId,
          name: names.get(r.authorId)?.fullName ?? "",
          stillHasAccess: access.has(r.authorId),
        },
        body: r.body,
        createdAt: r.createdAt.getTime(),
        editedAt: r.editedAt?.getTime() ?? null,
        canEdit:
          !target.locked && this.ctx.comments.editable(r, principal.userId),
      })),
      nextBefore,
      locked: target.locked,
    };
  }

  async addComment(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    body: string,
  ): Promise<CommentDto> {
    const loaded = await this.load(tenant, project, principal, id);
    if (loaded.access.archived) throw new ProjectArchivedError();
    if (
      (await this.ctx.comments.recentCount(principal.userId)) >=
      COMMENT_LIMITS.postsPerMinute
    ) {
      throw new RateLimitedError();
    }
    const target = this.commentTarget(loaded);
    const { row: posted, statements } = this.ctx.comments.add(
      target,
      principal.userId,
      body,
    );
    const { row, investigation, members } = loaded;
    const previous = await this.ctx.comments.list(target, null);
    const see = this.canSee(loaded);
    const recipients: string[] = [];
    for (const userId of new Set([
      row.reportedBy,
      ...(investigation ? [investigation.leadId] : []),
      ...members,
      ...previous.rows.map((r) => r.authorId),
    ])) {
      if (userId !== principal.userId && (await see(userId)))
        recipients.push(userId);
    }
    statements.push(
      ...(await this.ctx.notifications.groupedEntries(
        {
          type: "safety_event.comment_added",
          companyId: tenant.id,
          projectId: project.id,
          entityType: "safety_event",
          entityId: row.id,
          actorUserId: principal.userId,
          params: this.ctx.params(row, project, loaded.type),
          recipients,
        },
        COMMENT_LIMITS.groupWindowMs,
      )),
    );
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    const names = await userSummaries(this.ctx.db, [principal.userId]);
    return {
      id: posted.id,
      author: {
        id: principal.userId,
        name: names.get(principal.userId)?.fullName ?? "",
        stillHasAccess: true,
      },
      body: posted.body,
      createdAt: posted.createdAt.getTime(),
      editedAt: null,
      canEdit: true,
    };
  }

  async editComment(
    tenant: TenantCompany,
    project: ProjectArg,
    principal: Principal,
    id: string,
    commentId: string,
    body: string,
  ): Promise<CommentDto> {
    const loaded = await this.load(tenant, project, principal, id);
    if (loaded.access.archived) throw new ProjectArchivedError();
    const target = this.commentTarget(loaded);
    const existing = await this.ctx.comments.find(target, commentId);
    if (!existing) throw new NotFoundError();
    const { row: edited, statements } = this.ctx.comments.edit(
      target,
      existing,
      principal.userId,
      body,
    );
    await new UnitOfWork(this.ctx.db).add(...statements).commit();
    const names = await userSummaries(this.ctx.db, [principal.userId]);
    return {
      id: edited.id,
      author: {
        id: principal.userId,
        name: names.get(principal.userId)?.fullName ?? "",
        stillHasAccess: true,
      },
      body: edited.body,
      createdAt: edited.createdAt.getTime(),
      editedAt: edited.editedAt?.getTime() ?? null,
      canEdit: this.ctx.comments.editable(edited, principal.userId),
    };
  }
}
