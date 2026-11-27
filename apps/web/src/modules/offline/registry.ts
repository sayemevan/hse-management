import type { ReactNode } from 'react';

import type { OutboxItem } from './device-store';

/**
 * T-72: how modules plug into the offline layer. The layer never imports a business module;
 * a module registers its record types and reference data in its own client code.
 */
export interface OfflineEntity {
  /** Matches the API's sync entity type, e.g. `inspection` (`dev.sync_probe` in Sprint 9). */
  type: string;
  /** Translation key of the type's name, shown in the sync centre. */
  labelKey: string;
  /** Pages that work offline for this type: pre-cached by the service worker (PLT-25). */
  routes: readonly string[];
  /** Fields compared on the conflict review screen (the API's `conflictFields`). */
  conflictFields: readonly string[];
  /** Updates the module's device copy with the server's answer (number, version, …). */
  fromServer?: (item: OutboxItem) => Promise<void> | void;
  /** Renders one value on the conflict review screen; plain text when absent. */
  renderValue?: (field: string, value: unknown) => ReactNode;
}

export interface ReferencePack {
  key: string;
  scope: 'user' | 'project';
  /** Refreshed when older than this (PLT-26, default 12 h). */
  maxAgeHours?: number;
  load: (scopeId: string, etag: string | null) => Promise<{ data: unknown; etag: string | null } | 'unchanged'>;
}

/** A conflict resolution chosen offline (PLT-30), queued like any other change. */
export const RESOLUTION_TYPE = 'sync.resolution';

const entities = new Map<string, OfflineEntity>();
const packs = new Map<string, ReferencePack>();

export function registerOfflineEntity(entity: OfflineEntity): void {
  entities.set(entity.type, entity);
}

export function offlineEntity(type: string): OfflineEntity | undefined {
  return entities.get(type);
}

export function registerReferencePack(pack: ReferencePack): void {
  packs.set(pack.key, pack);
}

export function referencePacks(): ReferencePack[] {
  return [...packs.values()];
}

/** The pages of the sync layer itself; they always work offline. */
export const OFFLINE_SHELL_ROUTES = ['/sync', '/offline'] as const;

/** Pages that work offline: the shell's and the registered types'. */
export function offlineRoutes(): string[] {
  const routes = new Set<string>(OFFLINE_SHELL_ROUTES);
  for (const entity of entities.values()) for (const route of entity.routes) routes.add(route);
  return [...routes];
}

/** What the service worker pre-caches: the offline pages and the home page, which starts the
 * app and shows the offline notice with links to them. */
export function precacheRoutes(): string[] {
  return ['/', ...offlineRoutes()];
}

/** May this page open offline? (`/sync?conflict=…` counts as `/sync`.) */
export function isOfflineRoute(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return offlineRoutes().some((route) => route === path);
}
