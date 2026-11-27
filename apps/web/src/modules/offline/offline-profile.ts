import {
  type CurrentUserDto,
  type OfflinePackDto,
  type OfflineProfile,
  type OfflineProfileDto,
  OFFLINE_LIMITS,
} from '@hse/shared';

import { authorizedRequest, syncAccessToken } from '@/modules/auth/auth-session';
import { publicEnv } from '@/config/public-env';

import {
  deleteReference,
  deviceStore,
  listReferences,
  readMeta,
  readReference,
  writeMeta,
  writeReference,
} from './device-store';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// ---- Offline profile (PLT-27, T-73) ---------------------------------------------------------

/** Saves the profile after an online start. Never a token or a password (FR-5). */
export async function saveOfflineProfile(user: CurrentUserDto, now = Date.now()): Promise<void> {
  const db = await deviceStore();
  if (!db) return;
  const dto = (await authorizedRequest<OfflineProfileDto>('/me/offline-profile')).data;
  const profile: OfflineProfile = { ...dto, user, savedAt: now };
  await db.put('session', { ...profile, userId: user.id });
  await writeMeta('lastUserId', user.id);
}

/** The profile of the last user, if it may still be used offline (7 days, O-118). */
export async function usableOfflineProfile(now = Date.now()): Promise<OfflineProfile | null> {
  const db = await deviceStore();
  if (!db) return null;
  const userId = await readMeta<string>('lastUserId');
  if (!userId) return null;
  const row = await db.get('session', userId);
  if (!row) return null;
  if (now - row.savedAt > OFFLINE_LIMITS.profileMaxAgeDays * DAY_MS) return null;
  return row;
}

/** A deliberate sign-out: the next offline start doesn't open as this user (queued items stay). */
export async function forgetOfflineSession(): Promise<void> {
  await writeMeta('lastUserId', null);
}

/** Any stored profile of this user, however old (permission hints in the sync centre). */
export async function storedProfile(userId: string): Promise<OfflineProfile | null> {
  const db = await deviceStore();
  return (await db?.get('session', userId)) ?? null;
}

/** May the user do this on the project offline? A hint: the server re-checks (T-73). */
export function profileAllows(
  profile: OfflineProfile | null,
  projectId: string,
  permission: string,
): boolean {
  return profile?.projects.find((p) => p.id === projectId)?.permissions.includes(permission) ?? false;
}

// ---- Projects kept on the device (PLT-26) ---------------------------------------------------

interface KeptProjects {
  pinned: string[];
  recent: string[];
}

async function keptProjects(userId: string): Promise<KeptProjects> {
  return (await readMeta<KeptProjects>(`kept:${userId}`)) ?? { pinned: [], recent: [] };
}

export class OfflineProjectLimitError extends Error {
  constructor() {
    super('Up to 10 projects can be kept on this device.');
    this.name = 'OfflineProjectLimitError';
  }
}

/** The projects whose packs stay on the device: pinned first, then the last 3 opened. */
export function projectsToKeep(kept: KeptProjects): string[] {
  const result = [...kept.pinned];
  for (const id of kept.recent) {
    if (result.length >= OFFLINE_LIMITS.maxOfflineProjects) break;
    if (!result.includes(id)) result.push(id);
  }
  return result.slice(0, OFFLINE_LIMITS.maxOfflineProjects);
}

export async function isPinned(userId: string, projectId: string): Promise<boolean> {
  return (await keptProjects(userId)).pinned.includes(projectId);
}

export async function setPinned(userId: string, projectId: string, pinned: boolean): Promise<void> {
  const kept = await keptProjects(userId);
  const without = kept.pinned.filter((id) => id !== projectId);
  if (pinned && without.length >= OFFLINE_LIMITS.maxOfflineProjects) throw new OfflineProjectLimitError();
  await writeMeta(`kept:${userId}`, { ...kept, pinned: pinned ? [...without, projectId] : without });
  if (pinned) await refreshProjectPack(userId, projectId, { force: true });
  await prunePacks(userId);
}

/** The user opened a project: remember it and fetch its pack in the background. */
export async function projectOpened(userId: string, projectId: string): Promise<void> {
  const kept = await keptProjects(userId);
  const recent = [projectId, ...kept.recent.filter((id) => id !== projectId)].slice(
    0,
    OFFLINE_LIMITS.recentOfflineProjects,
  );
  await writeMeta(`kept:${userId}`, { ...kept, recent });
  await refreshProjectPack(userId, projectId, {});
  await prunePacks(userId);
}

async function prunePacks(userId: string): Promise<void> {
  const keep = new Set(projectsToKeep(await keptProjects(userId)));
  for (const row of await listReferences(userId)) {
    if (row.packKey === 'project-pack' && !keep.has(row.scopeId)) {
      await deleteReference(userId, row.packKey, row.scopeId);
    }
  }
}

/** PLT-26 FR-4: fetch with the stored ETag; keep the old pack when anything fails. */
export async function refreshProjectPack(
  userId: string,
  projectId: string,
  options: { force?: boolean; now?: number },
): Promise<void> {
  const now = options.now ?? Date.now();
  const current = await readReference<OfflinePackDto>(userId, 'project-pack', projectId);
  if (current && !options.force && now - current.fetchedAt < OFFLINE_LIMITS.packMaxAgeHours * HOUR_MS) {
    return;
  }
  const token = await syncAccessToken().catch(() => null);
  if (!token) return;
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (current?.etag) headers['if-none-match'] = current.etag;
  const response = await fetch(`${publicEnv.apiBaseUrl}/projects/${projectId}/offline-pack`, {
    headers,
    credentials: 'same-origin',
  }).catch(() => null);
  if (!response) return;
  if (response.status === 304 && current) {
    await writeReference({ ...current, fetchedAt: now });
    return;
  }
  if (response.status === 404 || response.status === 403) {
    await deleteReference(userId, 'project-pack', projectId);
    return;
  }
  if (!response.ok) return;
  const body = (await response.json().catch(() => null)) as { data?: OfflinePackDto } | null;
  if (!body?.data?.project) return;
  await writeReference({
    userId,
    packKey: 'project-pack',
    scopeId: projectId,
    data: body.data,
    etag: response.headers.get('ETag'),
    fetchedAt: now,
  });
}

/** Refresh offline data (sync centre): every kept project's pack. */
export async function refreshAllPacks(userId: string): Promise<void> {
  for (const projectId of projectsToKeep(await keptProjects(userId))) {
    await refreshProjectPack(userId, projectId, { force: true });
  }
}

export interface KeptPack {
  projectId: string;
  code: string;
  name: string;
  fetchedAt: number;
  pinned: boolean;
}

export async function listKeptPacks(userId: string): Promise<KeptPack[]> {
  const kept = await keptProjects(userId);
  return (await listReferences(userId))
    .filter((row) => row.packKey === 'project-pack')
    .map((row) => {
      const pack = row.data as OfflinePackDto;
      return {
        projectId: row.scopeId,
        code: pack.project.code,
        name: pack.project.name,
        fetchedAt: row.fetchedAt,
        pinned: kept.pinned.includes(row.scopeId),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
