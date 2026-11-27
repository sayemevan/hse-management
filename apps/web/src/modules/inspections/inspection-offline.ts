import {
  FINDING_SEVERITIES,
  INSPECTION_CONFLICT_FIELDS,
  INSPECTION_ENTITY,
  INSPECTION_ITEM_CONFLICT_FIELDS,
  INSPECTION_ITEM_ENTITY,
  INSPECTION_TEMPLATES_PACK,
  type InspectionDto,
  type InspectionItemDto,
  type InspectionResult,
  type InspectionStatus,
  type InspectionWeather,
  type PlaceSelection,
  type TemplateContent,
  type TemplatePackDto,
  type TemplatePackVersionDto,
} from '@hse/shared';

import { syncAccessToken } from '@/modules/auth/auth-session';
import { publicEnv } from '@/config/public-env';
import { deviceStore, type DraftRow, readReference, writeReference } from '@/modules/offline/device-store';
import { enqueue, listOutbox } from '@/modules/offline/outbox';
import type { CompressedPhoto } from '@/modules/offline/photo';
import { registerOfflineEntity } from '@/modules/offline/registry';

/** T-80: the pages that work offline (one page for every inspection; ids in the query). */
export const MY_INSPECTIONS_ROUTE = '/inspections';
export const START_ROUTE = '/inspections/start';
export const CAPTURE_ROUTE = '/inspections/capture';

export function captureHref(projectId: string, id: string): string {
  return `${CAPTURE_ROUTE}?project=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`;
}

/** One item as the device knows it. */
export interface ItemCopy {
  result: InspectionResult | null;
  comment: string | null;
  priority: (typeof FINDING_SEVERITIES)[number] | null;
  assignedTo: string | null;
  assignedName: string | null;
  raiseFinding: boolean;
  /** Server version; 0 while unknown (never synced). */
  version: number;
}

/** The device copy of an inspection the user captures (drafts store). */
export interface InspectionCopy {
  id: string;
  projectId: string;
  projectCode: string;
  templateId: string;
  versionId: string;
  versionNo: number;
  templateNameEn: string | null;
  templateNameAr: string | null;
  content: TemplateContent;
  status: InspectionStatus;
  /** null until the server gave the number (T-82). */
  reference: string | null;
  place: PlaceSelection;
  placeName: string | null;
  inspectedOn: string | null;
  plannedOn: string | null;
  weather: InspectionWeather | null;
  notes: string | null;
  items: Record<string, ItemCopy>;
  /** Photos per item key (`''` for the header): server ones plus queued ones. */
  photos: Record<string, number>;
  /** Server version of the header; 0 while unknown. */
  version: number;
  /** Submitted on this device, waiting to sync. */
  submittedHere: boolean;
  updatedAt: number;
}

/** T-80: outbox labels are language-neutral; the sync centre renders them in the reader's language. */
export function outboxLabel(copy: Pick<InspectionCopy, 'templateNameEn' | 'templateNameAr' | 'reference'>): string {
  return JSON.stringify({
    kind: 'inspection',
    en: copy.templateNameEn,
    ar: copy.templateNameAr,
    ref: copy.reference,
  });
}

// ---- Device copies --------------------------------------------------------------------------

async function save(userId: string, copy: InspectionCopy): Promise<void> {
  const db = await deviceStore();
  const row: DraftRow = { userId, entityType: INSPECTION_ENTITY, id: copy.id, data: copy, updatedAt: copy.updatedAt };
  await db?.put('drafts', row);
}

export async function readCopy(userId: string, id: string): Promise<InspectionCopy | undefined> {
  const db = await deviceStore();
  return (await db?.get('drafts', [userId, INSPECTION_ENTITY, id]))?.data as InspectionCopy | undefined;
}

export async function listCopies(userId: string): Promise<InspectionCopy[]> {
  const db = await deviceStore();
  const rows = (await db?.getAllFromIndex('drafts', 'byUser', userId)) ?? [];
  return rows
    .filter((row) => row.entityType === INSPECTION_ENTITY)
    .map((row) => row.data as InspectionCopy)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function removeCopy(userId: string, id: string): Promise<void> {
  const db = await deviceStore();
  await db?.delete('drafts', [userId, INSPECTION_ENTITY, id]);
}

function itemFromDto(item: InspectionItemDto): ItemCopy {
  return {
    result: item.result,
    comment: item.comment,
    priority: item.priority,
    assignedTo: item.assignedTo?.id ?? null,
    assignedName: item.assignedTo?.name ?? null,
    raiseFinding: item.raiseFinding,
    version: item.version,
  };
}

/** Keeps the server's copy on the device for offline capture, without losing pending edits. */
export async function keepFromServer(userId: string, dto: InspectionDto): Promise<InspectionCopy> {
  const existing = await readCopy(userId, dto.id);
  const pending = (await listOutbox(userId)).some(
    (item) => item.entityId === dto.id && item.state !== 'synced',
  );
  const photos: Record<string, number> = {};
  for (const file of dto.files) photos[file.itemKey ?? ''] = (photos[file.itemKey ?? ''] ?? 0) + 1;
  const fromServer: InspectionCopy = {
    id: dto.id,
    projectId: dto.projectId,
    projectCode: dto.projectCode,
    templateId: dto.templateId,
    versionId: dto.templateVersionId,
    versionNo: dto.versionNo,
    templateNameEn: dto.templateNameEn,
    templateNameAr: dto.templateNameAr,
    content: dto.content,
    status: dto.status,
    reference: dto.reference,
    place: dto.place,
    placeName: dto.placeName,
    inspectedOn: dto.inspectedOn,
    plannedOn: dto.plannedOn,
    weather: dto.weather,
    notes: dto.notes,
    items: Object.fromEntries(dto.items.map((item) => [item.itemKey, itemFromDto(item)])),
    photos,
    version: dto.version,
    submittedHere: false,
    updatedAt: dto.updatedAt,
  };
  if (existing && pending) {
    // Local edits win on the device until they sync; take the server's numbers and versions.
    const merged: InspectionCopy = {
      ...existing,
      reference: dto.reference,
      version: Math.max(existing.version, dto.version),
      items: Object.fromEntries(
        Object.entries(existing.items).map(([key, item]) => [
          key,
          { ...item, version: Math.max(item.version, fromServer.items[key]?.version ?? 0) },
        ]),
      ),
    };
    await save(userId, merged);
    return merged;
  }
  await save(userId, fromServer);
  return fromServer;
}

// ---- Queued changes (T-68 – T-70, T-80) -----------------------------------------------------

const path = (copy: Pick<InspectionCopy, 'projectId' | 'id'>, suffix = '') =>
  `/projects/${copy.projectId}/inspections/${copy.id}${suffix}`;

async function pendingFor(userId: string, id: string) {
  return (await listOutbox(userId)).filter((item) => item.entityId === id && item.state !== 'synced');
}

/** The create of a record started on this device, if it hasn't synced yet. */
async function pendingCreate(userId: string, id: string): Promise<number | null> {
  const create = (await pendingFor(userId, id)).find((item) => item.kind === 'create');
  return create?.seq ?? null;
}

/** US-033: an inspection started on the spot (online or offline): the device makes its id. */
export async function queueStart(
  userId: string,
  input: {
    project: { id: string; code: string };
    version: TemplatePackVersionDto;
    place: PlaceSelection;
    placeName: string | null;
    inspectedOn: string;
    weather: InspectionWeather | null;
    location: { latitude: number; longitude: number; accuracy: number | null } | null;
  },
): Promise<InspectionCopy> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const copy: InspectionCopy = {
    id,
    projectId: input.project.id,
    projectCode: input.project.code,
    templateId: input.version.templateId,
    versionId: input.version.versionId,
    versionNo: input.version.versionNo,
    templateNameEn: input.version.nameEn,
    templateNameAr: input.version.nameAr,
    content: input.version.content,
    status: 'in_progress',
    reference: null,
    place: input.place,
    placeName: input.placeName,
    inspectedOn: input.inspectedOn,
    plannedOn: null,
    weather: input.weather,
    notes: null,
    items: {},
    photos: {},
    version: 0,
    submittedHere: false,
    updatedAt: now,
  };
  await save(userId, copy);
  await enqueue({
    userId,
    entityType: INSPECTION_ENTITY,
    entityId: id,
    kind: 'create',
    label: outboxLabel(copy),
    projectCode: input.project.code,
    request: {
      method: 'POST',
      path: `/projects/${input.project.id}/inspections`,
      body: {
        mode: 'start',
        id,
        templateVersionId: input.version.versionId,
        place: input.place,
        inspectedOn: input.inspectedOn,
        weather: input.weather,
        location: input.location,
      },
      contractVersion: 1,
    },
  });
  return copy;
}

/** US-033: start a planned inspection (a transition), online or offline. */
export async function queueStartPlanned(userId: string, copy: InspectionCopy): Promise<InspectionCopy> {
  const next: InspectionCopy = { ...copy, status: 'in_progress', updatedAt: Date.now() };
  await save(userId, next);
  await enqueue({
    userId,
    entityType: INSPECTION_ENTITY,
    entityId: copy.id,
    kind: 'custom',
    label: outboxLabel(copy),
    projectCode: copy.projectCode,
    request: { method: 'POST', path: path(copy, '/transitions'), body: { to: 'start' }, contractVersion: 1 },
  });
  return next;
}

/** US-034: one item's changed fields only (an untouched field must not look like a conflict). */
export async function queueItem(
  userId: string,
  copy: InspectionCopy,
  itemKey: string,
  changes: Partial<Omit<ItemCopy, 'version'>>,
): Promise<InspectionCopy> {
  const before = copy.items[itemKey] ?? {
    result: null,
    comment: null,
    priority: null,
    assignedTo: null,
    assignedName: null,
    raiseFinding: false,
    version: 0,
  };
  const after: ItemCopy = { ...before, ...changes };
  if (after.result !== 'fail' && after.result !== 'observation') after.priority = null;
  if (after.result !== 'observation') after.raiseFinding = false;
  const body: Record<string, unknown> = {};
  for (const field of ['result', 'comment', 'priority', 'assignedTo', 'raiseFinding'] as const) {
    if (after[field] !== before[field]) body[field] = after[field];
  }
  const next: InspectionCopy = { ...copy, items: { ...copy.items, [itemKey]: after }, updatedAt: Date.now() };
  await save(userId, next);
  if (Object.keys(body).length === 0) return next;
  const pending = await pendingFor(userId, copy.id);
  const samePending = pending.some((item) => item.request.path.endsWith(`/items/${itemKey}`));
  // T-70: compare with the server's version only when this device knows it and nothing for
  // this item is still waiting (a second queued edit would otherwise conflict with the first).
  if (before.version > 0 && !samePending) body.baseVersion = before.version;
  await enqueue({
    userId,
    entityType: INSPECTION_ENTITY,
    entityId: copy.id,
    kind: 'update',
    label: outboxLabel(copy),
    projectCode: copy.projectCode,
    dependsOn: await pendingCreate(userId, copy.id),
    request: { method: 'PUT', path: path(copy, `/items/${itemKey}`), body, contractVersion: 1 },
  });
  return next;
}

/** US-034: header fields (place, date, weather, notes). */
export async function queueHeader(
  userId: string,
  copy: InspectionCopy,
  changes: Partial<Pick<InspectionCopy, 'inspectedOn' | 'weather' | 'notes'>>,
): Promise<InspectionCopy> {
  const body: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(changes)) {
    if (copy[field as keyof InspectionCopy] !== value) body[field] = value;
  }
  const next: InspectionCopy = { ...copy, ...changes, updatedAt: Date.now() };
  await save(userId, next);
  if (Object.keys(body).length === 0) return next;
  const pending = await pendingFor(userId, copy.id);
  const headerPending = pending.some((item) => item.request.method !== 'PUT' && item.kind !== 'upload');
  if (copy.version > 0 && !headerPending) body.baseVersion = copy.version;
  await enqueue({
    userId,
    entityType: INSPECTION_ENTITY,
    entityId: copy.id,
    kind: 'update',
    label: outboxLabel(copy),
    projectCode: copy.projectCode,
    dependsOn: await pendingCreate(userId, copy.id),
    request: { method: 'PATCH', path: path(copy), body, contractVersion: 1 },
  });
  return next;
}

/** US-035: a compressed photo for an item (or the header when `itemKey` is null). */
export async function queuePhoto(
  userId: string,
  copy: InspectionCopy,
  itemKey: string | null,
  photo: CompressedPhoto,
): Promise<InspectionCopy> {
  const slot = itemKey ?? '';
  const next: InspectionCopy = {
    ...copy,
    photos: { ...copy.photos, [slot]: (copy.photos[slot] ?? 0) + 1 },
    updatedAt: Date.now(),
  };
  await save(userId, next);
  await enqueue({
    userId,
    entityType: INSPECTION_ENTITY,
    entityId: copy.id,
    kind: 'upload',
    label: outboxLabel(copy),
    projectCode: copy.projectCode,
    dependsOn: await pendingCreate(userId, copy.id),
    request: {
      method: 'POST',
      path: path(copy, '/files'),
      body: itemKey ? { itemKey } : {},
      contractVersion: 1,
      fileField: 'file',
    },
    blob: { bytes: photo.bytes, type: photo.type, name: photo.name },
  });
  return next;
}

/** US-036: submit after every earlier change of this inspection (same record: strict order). */
export async function queueSubmit(
  userId: string,
  copy: InspectionCopy,
  findingChoices: { itemKey: string; decision: 'raise_action' | 'no_action'; reason?: string | null }[] = [],
): Promise<InspectionCopy> {
  const next: InspectionCopy = { ...copy, submittedHere: true, updatedAt: Date.now() };
  await save(userId, next);
  await enqueue({
    userId,
    entityType: INSPECTION_ENTITY,
    entityId: copy.id,
    kind: 'custom',
    label: outboxLabel(copy),
    projectCode: copy.projectCode,
    dependsOn: await pendingCreate(userId, copy.id),
    request: {
      method: 'POST',
      path: path(copy, '/transitions'),
      body: { to: 'submit', ...(findingChoices.length > 0 ? { findingChoices } : {}) },
      contractVersion: 1,
    },
  });
  return next;
}

// ---- Templates pack (T-80) ------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

/** The published template versions kept on the device (company-wide pack). */
export async function readTemplatePack(userId: string): Promise<TemplatePackDto | null> {
  return (await readReference<TemplatePackDto>(userId, INSPECTION_TEMPLATES_PACK, 'company'))?.data ?? null;
}

export async function refreshTemplatePack(userId: string, force = false): Promise<TemplatePackDto | null> {
  const current = await readReference<TemplatePackDto>(userId, INSPECTION_TEMPLATES_PACK, 'company');
  const now = Date.now();
  if (current && !force && now - current.fetchedAt < HOUR_MS) return current.data;
  const token = await syncAccessToken().catch(() => null);
  if (!token) return current?.data ?? null;
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (current?.etag) headers['if-none-match'] = current.etag;
  const response = await fetch(`${publicEnv.apiBaseUrl}/inspection-templates/offline-pack`, {
    headers,
    credentials: 'same-origin',
  }).catch(() => null);
  if (!response) return current?.data ?? null;
  if (response.status === 304 && current) {
    await writeReference({ ...current, fetchedAt: now });
    return current.data;
  }
  if (!response.ok) return current?.data ?? null;
  const body = (await response.json().catch(() => null)) as { data?: TemplatePackDto } | null;
  if (!body?.data) return current?.data ?? null;
  await writeReference({
    userId,
    packKey: INSPECTION_TEMPLATES_PACK,
    scopeId: 'company',
    data: body.data,
    etag: response.headers.get('ETag'),
    fetchedAt: now,
  });
  return body.data;
}

// ---- Registration (T-72) --------------------------------------------------------------------

export function registerInspections(): void {
  registerOfflineEntity({
    type: INSPECTION_ENTITY,
    labelKey: 'inspections.offline.type',
    routes: [MY_INSPECTIONS_ROUTE, START_ROUTE, CAPTURE_ROUTE],
    conflictFields: INSPECTION_CONFLICT_FIELDS,
    async fromServer(item) {
      const copy = await readCopy(item.userId, item.entityId);
      if (!copy) return;
      const result = item.result as Partial<InspectionDto & InspectionItemDto> | null;
      if (!result) return;
      if (typeof result.itemKey === 'string' && typeof result.version === 'number') {
        const existing = copy.items[result.itemKey];
        if (!existing) return;
        await save(item.userId, {
          ...copy,
          items: { ...copy.items, [result.itemKey]: { ...existing, version: Math.max(existing.version, result.version) } },
        });
        return;
      }
      if (typeof result.status === 'string' && typeof result.version === 'number') {
        await save(item.userId, {
          ...copy,
          reference: result.reference ?? copy.reference,
          status: result.status,
          version: Math.max(copy.version, result.version),
          submittedHere: result.status === 'in_progress' ? copy.submittedHere : false,
        });
      }
    },
  });
  // Conflicts on items come back with their own type (PLT-30); the review shows these fields.
  registerOfflineEntity({
    type: INSPECTION_ITEM_ENTITY,
    labelKey: 'inspections.offline.itemType',
    routes: [],
    conflictFields: INSPECTION_ITEM_CONFLICT_FIELDS,
  });
}
