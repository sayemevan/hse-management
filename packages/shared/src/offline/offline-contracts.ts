import { z } from 'zod';

import type { CurrentUserDto } from '../auth/auth-contracts';
import type { PlaceTreeDto } from '../projects/place-contracts';

/**
 * Sprint 9 — offline foundation (PLT-25 – PLT-31, D-56, D-57). Contracts shared by the API
 * and the web app's offline layer: headers, limits, the offline profile and pack, conflicts
 * and the development-only sync probe.
 */

// ---- Headers (T-69, O-129, O-130) -----------------------------------------------------------

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';
export const CAPTURED_AT_HEADER = 'X-Captured-At';
export const DEVICE_ID_HEADER = 'X-Device-Id';

// ---- Limits ---------------------------------------------------------------------------------

export const OFFLINE_LIMITS = {
  /** O-118: the offline profile works this long after it was refreshed online. */
  profileMaxAgeDays: 7,
  /** O-124: idempotency keys are kept this long. */
  idempotencyKeyDays: 30,
  /** O-121 / T-74: photo compression. */
  photoLongEdge: 2560,
  photoQuality: 0.82,
  photosPerRecord: 20,
  /** O-120: synced items stay visible on the device this long. */
  syncedRetentionHours: 24,
  /** O-120: storage warning and refusal thresholds (share of the browser's quota). */
  storageWarnRatio: 0.8,
  storageRefuseRatio: 0.95,
  /** O-131: one reminder for an open conflict after this many days. */
  conflictReminderDays: 2,
  /** PLT-26: projects kept on the device. */
  maxOfflineProjects: 10,
  recentOfflineProjects: 3,
  packMaxAgeHours: 12,
  /** O-129: a capture time further in the future than this is replaced by the receive time. */
  futureCaptureToleranceMs: 24 * 60 * 60 * 1000,
  /** O-129: "synced later" is shown when capture and receive differ by more than this. */
  syncedLaterMs: 15 * 60 * 1000,
} as const;

/** T-71: retry delays after a failed attempt; the last one repeats. */
export const SYNC_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000] as const;

export function syncBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), SYNC_BACKOFF_MS.length) - 1;
  return SYNC_BACKOFF_MS[index] ?? 900_000;
}

/** O-129: the capture time the server keeps for an offline change. */
export function acceptedCaptureTime(capturedAt: number | null, receivedAt: number): number {
  if (capturedAt === null || !Number.isFinite(capturedAt)) return receivedAt;
  return capturedAt - receivedAt > OFFLINE_LIMITS.futureCaptureToleranceMs ? receivedAt : capturedAt;
}

// ---- Offline profile (PLT-27, T-73) ---------------------------------------------------------

export interface OfflineProjectDto {
  id: string;
  code: string;
  name: string;
  status: string;
  /** Project-scope permissions of the user on this project (a hint; the server re-checks). */
  permissions: string[];
}

/** `GET /me/offline-profile`. The device stores it with the signed-in user (`OfflineProfile`). */
export interface OfflineProfileDto {
  company: { slug: string; name: string; timeZone: string; readOnly: boolean };
  projects: OfflineProjectDto[];
  generatedAt: number;
}

/** What the device keeps for offline mode (T-73): the profile plus `/auth/me`. No tokens. */
export interface OfflineProfile extends OfflineProfileDto {
  user: CurrentUserDto;
  savedAt: number;
}

// ---- Offline pack (PLT-26) ------------------------------------------------------------------

export interface OfflinePackMemberDto {
  id: string;
  fullName: string;
}

export interface OfflinePackDto {
  project: { id: string; code: string; name: string; status: string };
  places: PlaceTreeDto;
  members: OfflinePackMemberDto[];
  generatedAt: number;
}

// ---- Conflicts (PLT-30, T-70, O-122) --------------------------------------------------------

export const SYNC_CONFLICT_STATUSES = ['open', 'resolved', 'discarded', 'superseded'] as const;
export type SyncConflictStatus = (typeof SYNC_CONFLICT_STATUSES)[number];

export const SYNC_CONFLICT_CHOICES = ['mine', 'theirs', 'combine'] as const;
export type SyncConflictChoice = (typeof SYNC_CONFLICT_CHOICES)[number];

export interface SyncConflictSummaryDto {
  id: string;
  entityType: string;
  entityId: string;
  label: string;
  projectCode: string | null;
  serverVersion: number;
  /** Who made the server's version, when known. */
  changedBy: string | null;
  createdAt: number;
  status: SyncConflictStatus;
}

export interface SyncConflictDto extends SyncConflictSummaryDto {
  baseVersion: number;
  /** Fields the user may combine (the module's `conflictFields`). */
  fields: string[];
  clientPayload: Record<string, unknown>;
  serverSnapshot: Record<string, unknown>;
  resolution: SyncConflictChoice | null;
  resolvedAt: number | null;
}

/** The `params` of a `409 SYNC_CONFLICT` error. */
export interface SyncConflictErrorParams {
  conflictId: string;
  serverVersion: number;
}

export const conflictListQuerySchema = z.object({
  status: z.enum(SYNC_CONFLICT_STATUSES).default('open'),
});

export const resolveConflictRequestSchema = z
  .object({
    choice: z.enum(SYNC_CONFLICT_CHOICES),
    values: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => value.choice !== 'combine' || value.values !== undefined, {
    message: 'Choose a value for each field.',
    path: ['values'],
  });
export type ResolveConflictRequest = z.input<typeof resolveConflictRequestSchema>;

export interface ResolveConflictResultDto {
  status: SyncConflictStatus;
  record: Record<string, unknown> | null;
}

// ---- Sync probe (O-116: development and test builds only) -----------------------------------

export const SYNC_PROBE_LIMITS = { titleMax: 100, noteMax: 2000 } as const;
export const SYNC_PROBE_CONFLICT_FIELDS = ['title', 'note'] as const;

export const createSyncProbeRequestSchema = z.object({
  /** T-68: made on the device. */
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(SYNC_PROBE_LIMITS.titleMax),
  note: z.string().trim().max(SYNC_PROBE_LIMITS.noteMax).default(''),
});
export type CreateSyncProbeRequest = z.input<typeof createSyncProbeRequestSchema>;

export const updateSyncProbeRequestSchema = z.object({
  baseVersion: z.number().int().min(1),
  title: z.string().trim().min(1).max(SYNC_PROBE_LIMITS.titleMax).optional(),
  note: z.string().trim().max(SYNC_PROBE_LIMITS.noteMax).optional(),
});
export type UpdateSyncProbeRequest = z.input<typeof updateSyncProbeRequestSchema>;

export interface SyncProbeDto {
  id: string;
  title: string;
  note: string;
  version: number;
  photoIds: string[];
  capturedAt: number;
  receivedAt: number;
  updatedAt: number;
}
