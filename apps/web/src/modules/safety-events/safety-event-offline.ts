import {
  type ReportSafetyEventRequest,
  SAFETY_EVENT_CONFLICT_FIELDS,
  SAFETY_EVENT_ENTITY,
  SAFETY_EVENT_SETTINGS_PACK,
  type SafetyEventDto,
  type SafetyEventFamily,
  type SafetyEventStatus,
  type SafetyEventSummaryDto,
  type SafetySettingsPackDto,
  type SafetySeverity,
} from "@hse/shared";

import { publicEnv } from "@/config/public-env";
import { syncAccessToken } from "@/modules/auth/auth-session";
import {
  deviceStore,
  type DraftRow,
  readReference,
  writeReference,
} from "@/modules/offline/device-store";
import { enqueue, listOutbox } from "@/modules/offline/outbox";
import type { CompressedPhoto } from "@/modules/offline/photo";
import { registerOfflineEntity } from "@/modules/offline/registry";

/** T-90: the pages that work offline. */
export const MY_REPORTS_ROUTE = "/safety-events";
export const REPORT_ROUTE = "/safety-events/report";

export function eventHref(projectId: string, id: string): string {
  return `/projects/${encodeURIComponent(projectId)}/safety-events/${encodeURIComponent(id)}`;
}

/** A report as this device knows it: sent or queued (My reports offline, O-167). */
export interface ReportCopy {
  id: string;
  projectId: string;
  projectCode: string;
  typeId: string;
  typeNameEn: string | null;
  typeNameAr: string | null;
  family: SafetyEventFamily;
  title: string;
  occurredAt: number;
  reportedSeverity: SafetySeverity;
  /** null until the server gave the number (T-91). */
  reference: string | null;
  status: SafetyEventStatus;
  closureSummary: string | null;
  photos: number;
  /** Server version; 0 while unknown. */
  version: number;
  updatedAt: number;
}

/** An unsent report kept on this device only (O-157 Draft). */
export interface ReportDraft {
  id: string;
  projectId: string;
  projectCode: string;
  body: Partial<ReportSafetyEventRequest>;
  typeNameEn: string | null;
  typeNameAr: string | null;
  updatedAt: number;
}

const DRAFT_TYPE = "safety_event_draft";

/** T-90: language-neutral outbox labels, rendered in the reader's language. */
export function outboxLabel(
  copy: Pick<ReportCopy, "typeNameEn" | "typeNameAr" | "reference" | "title">,
): string {
  const title = copy.title.slice(0, 40);
  return JSON.stringify({
    kind: "safety_event",
    en: `${copy.typeNameEn ?? copy.typeNameAr ?? ""} · ${title}`,
    ar: `${copy.typeNameAr ?? copy.typeNameEn ?? ""} · ${title}`,
    ref: copy.reference,
  });
}

// ---- Device copies --------------------------------------------------------------------------

async function put(
  userId: string,
  entityType: string,
  id: string,
  data: unknown,
  updatedAt: number,
): Promise<void> {
  const db = await deviceStore();
  const row: DraftRow = { userId, entityType, id, data, updatedAt };
  await db?.put("drafts", row);
}

async function list<T>(userId: string, entityType: string): Promise<T[]> {
  const db = await deviceStore();
  const rows = (await db?.getAllFromIndex("drafts", "byUser", userId)) ?? [];
  return rows
    .filter((row) => row.entityType === entityType)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((row) => row.data as T);
}

export async function readCopy(
  userId: string,
  id: string,
): Promise<ReportCopy | undefined> {
  const db = await deviceStore();
  return (await db?.get("drafts", [userId, SAFETY_EVENT_ENTITY, id]))?.data as
    ReportCopy | undefined;
}

export function listCopies(userId: string): Promise<ReportCopy[]> {
  return list<ReportCopy>(userId, SAFETY_EVENT_ENTITY);
}

export function listDrafts(userId: string): Promise<ReportDraft[]> {
  return list<ReportDraft>(userId, DRAFT_TYPE);
}

export async function saveDraft(
  userId: string,
  draft: ReportDraft,
): Promise<void> {
  await put(userId, DRAFT_TYPE, draft.id, draft, draft.updatedAt);
}

export async function readDraft(
  userId: string,
  id: string,
): Promise<ReportDraft | undefined> {
  const db = await deviceStore();
  return (await db?.get("drafts", [userId, DRAFT_TYPE, id]))?.data as
    ReportDraft | undefined;
}

export async function removeDraft(userId: string, id: string): Promise<void> {
  const db = await deviceStore();
  await db?.delete("drafts", [userId, DRAFT_TYPE, id]);
}

/** Keeps the user's own reports on the device for My reports offline (last 20, PLT-33). */
export async function keepReports(
  userId: string,
  items: readonly SafetyEventSummaryDto[],
): Promise<void> {
  const pending = new Set(
    (await listOutbox(userId))
      .filter((item) => item.state !== "synced")
      .map((item) => item.entityId),
  );
  for (const item of items.slice(0, 20)) {
    if (pending.has(item.id)) continue;
    const existing = await readCopy(userId, item.id);
    const copy: ReportCopy = {
      id: item.id,
      projectId: item.projectId,
      projectCode: item.projectCode,
      typeId: item.typeId,
      typeNameEn: item.typeNameEn,
      typeNameAr: item.typeNameAr,
      family: item.family,
      title: item.title,
      occurredAt: item.occurredAt,
      reportedSeverity: item.reportedSeverity,
      reference: item.reference,
      status: item.status,
      closureSummary: existing?.closureSummary ?? null,
      photos: existing?.photos ?? 0,
      version: item.version,
      updatedAt: Date.now(),
    };
    await put(userId, SAFETY_EVENT_ENTITY, copy.id, copy, copy.updatedAt);
  }
}

// ---- Queued changes (T-68 – T-70, T-90) -----------------------------------------------------

/** US-040 – US-042: a report made on this device (online or offline): the device makes its id. */
export async function queueReport(
  userId: string,
  input: {
    project: { id: string; code: string };
    type: {
      id: string;
      nameEn: string | null;
      nameAr: string | null;
      family: SafetyEventFamily;
    };
    body: Omit<ReportSafetyEventRequest, "id">;
    photos: readonly CompressedPhoto[];
  },
): Promise<ReportCopy> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const copy: ReportCopy = {
    id,
    projectId: input.project.id,
    projectCode: input.project.code,
    typeId: input.type.id,
    typeNameEn: input.type.nameEn,
    typeNameAr: input.type.nameAr,
    family: input.type.family,
    title: input.body.title,
    occurredAt: input.body.occurredAt,
    reportedSeverity: input.body.reportedSeverity,
    reference: null,
    status: "reported",
    closureSummary: null,
    photos: input.photos.length,
    version: 0,
    updatedAt: now,
  };
  await put(userId, SAFETY_EVENT_ENTITY, id, copy, now);
  const create = await enqueue({
    userId,
    entityType: SAFETY_EVENT_ENTITY,
    entityId: id,
    kind: "create",
    label: outboxLabel(copy),
    projectCode: input.project.code,
    request: {
      method: "POST",
      path: `/projects/${input.project.id}/safety-events`,
      body: { ...input.body, id },
      contractVersion: 1,
    },
  });
  for (const photo of input.photos) {
    await enqueue({
      userId,
      entityType: SAFETY_EVENT_ENTITY,
      entityId: id,
      kind: "upload",
      label: outboxLabel(copy),
      projectCode: input.project.code,
      dependsOn: create,
      request: {
        method: "POST",
        path: `/projects/${input.project.id}/safety-events/${id}/files`,
        body: { category: "evidence" },
        contractVersion: 1,
        fileField: "file",
      },
      blob: { bytes: photo.bytes, type: photo.type, name: photo.name },
    });
  }
  return copy;
}

/** US-040 FR-4: a photo added to the reporter's report before review (online or offline). */
export async function queuePhoto(
  userId: string,
  copy: ReportCopy,
  photo: CompressedPhoto,
): Promise<ReportCopy> {
  const next: ReportCopy = {
    ...copy,
    photos: copy.photos + 1,
    updatedAt: Date.now(),
  };
  await put(userId, SAFETY_EVENT_ENTITY, copy.id, next, next.updatedAt);
  const pending = (await listOutbox(userId)).find(
    (item) =>
      item.entityId === copy.id &&
      item.kind === "create" &&
      item.state !== "synced",
  );
  await enqueue({
    userId,
    entityType: SAFETY_EVENT_ENTITY,
    entityId: copy.id,
    kind: "upload",
    label: outboxLabel(copy),
    projectCode: copy.projectCode,
    dependsOn: pending?.seq ?? null,
    request: {
      method: "POST",
      path: `/projects/${copy.projectId}/safety-events/${copy.id}/files`,
      body: { category: "evidence" },
      contractVersion: 1,
      fileField: "file",
    },
    blob: { bytes: photo.bytes, type: photo.type, name: photo.name },
  });
  return next;
}

/** The reporter's changed fields only (an untouched field must not look like a conflict). */
export async function queueReportEdit(
  userId: string,
  copy: ReportCopy,
  changes: Partial<
    Pick<
      ReportSafetyEventRequest,
      "title" | "description" | "reportedSeverity" | "immediateAction"
    >
  >,
): Promise<ReportCopy> {
  const next: ReportCopy = {
    ...copy,
    ...(changes.title ? { title: changes.title } : {}),
    ...(changes.reportedSeverity
      ? { reportedSeverity: changes.reportedSeverity }
      : {}),
    updatedAt: Date.now(),
  };
  await put(userId, SAFETY_EVENT_ENTITY, copy.id, next, next.updatedAt);
  const pending = (await listOutbox(userId)).filter(
    (item) => item.entityId === copy.id && item.state !== "synced",
  );
  const body: Record<string, unknown> = { ...changes };
  // T-70: compare with the server version only when known and nothing else is waiting.
  if (copy.version > 0 && pending.length === 0) body.baseVersion = copy.version;
  await enqueue({
    userId,
    entityType: SAFETY_EVENT_ENTITY,
    entityId: copy.id,
    kind: "update",
    label: outboxLabel(copy),
    projectCode: copy.projectCode,
    dependsOn: pending.find((item) => item.kind === "create")?.seq ?? null,
    request: {
      method: "PATCH",
      path: `/projects/${copy.projectId}/safety-events/${copy.id}`,
      body,
      contractVersion: 1,
    },
  });
  return next;
}

// ---- Settings pack (T-90) -------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

export async function readSettingsPack(
  userId: string,
): Promise<SafetySettingsPackDto | null> {
  return (
    (
      await readReference<SafetySettingsPackDto>(
        userId,
        SAFETY_EVENT_SETTINGS_PACK,
        "company",
      )
    )?.data ?? null
  );
}

export async function refreshSettingsPack(
  userId: string,
  force = false,
): Promise<SafetySettingsPackDto | null> {
  const current = await readReference<SafetySettingsPackDto>(
    userId,
    SAFETY_EVENT_SETTINGS_PACK,
    "company",
  );
  const now = Date.now();
  if (current && !force && now - current.fetchedAt < HOUR_MS)
    return current.data;
  const token = await syncAccessToken().catch(() => null);
  if (!token) return current?.data ?? null;
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (current?.etag) headers["if-none-match"] = current.etag;
  const response = await fetch(
    `${publicEnv.apiBaseUrl}/safety-event-settings/offline-pack`,
    {
      headers,
      credentials: "same-origin",
    },
  ).catch(() => null);
  if (!response) return current?.data ?? null;
  if (response.status === 304 && current) {
    await writeReference({ ...current, fetchedAt: now });
    return current.data;
  }
  if (!response.ok) return current?.data ?? null;
  const body = (await response.json().catch(() => null)) as {
    data?: SafetySettingsPackDto;
  } | null;
  if (!body?.data) return current?.data ?? null;
  await writeReference({
    userId,
    packKey: SAFETY_EVENT_SETTINGS_PACK,
    scopeId: "company",
    data: body.data,
    etag: response.headers.get("ETag"),
    fetchedAt: now,
  });
  return body.data;
}

// ---- Registration (T-72) --------------------------------------------------------------------

export function registerSafetyEvents(): void {
  registerOfflineEntity({
    type: SAFETY_EVENT_ENTITY,
    labelKey: "safetyEvents.offline.type",
    routes: [MY_REPORTS_ROUTE, REPORT_ROUTE],
    conflictFields: SAFETY_EVENT_CONFLICT_FIELDS,
    async fromServer(item) {
      const copy = await readCopy(item.userId, item.entityId);
      if (!copy) return;
      const result = item.result as Partial<SafetyEventDto> | null;
      if (!result || typeof result.version !== "number") return;
      await put(
        item.userId,
        SAFETY_EVENT_ENTITY,
        copy.id,
        {
          ...copy,
          reference: result.reference ?? copy.reference,
          status: result.status ?? copy.status,
          version: Math.max(copy.version, result.version),
          updatedAt: Date.now(),
        },
        Date.now(),
      );
    },
  });
}
