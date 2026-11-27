'use client';

import type { SyncConflictDto } from '@hse/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/modules/auth/auth-provider';
import { authorizedRequest } from '@/modules/auth/auth-session';

import { deviceId, type OutboxItem } from './device-store';
import { httpTransport } from './http-transport';
import { saveOfflineProfile } from './offline-profile';
import {
  countsOf,
  discard as discardItem,
  listOutbox,
  onOutboxChange,
  type OutboxCounts,
  pruneSynced,
  putOutboxItem,
  readBlob,
  removeDeviceConflict,
  saveDeviceConflict,
} from './outbox';
import { registerOfflineModules } from './offline-modules';
import { offlineEntity, RESOLUTION_TYPE } from './registry';
import { SyncEngine } from './sync-engine';

registerOfflineModules();

const INTERVAL_MS = 60_000;
const LOCK_NAME = 'hse-sync';

export interface StorageUse {
  usage: number;
  quota: number;
}

interface SyncContextValue {
  /** The browser has a connection (and the app isn't in offline mode). */
  online: boolean;
  syncing: boolean;
  items: OutboxItem[];
  counts: OutboxCounts;
  storage: StorageUse | null;
  /** IndexedDB works in this browser (PLT-26: private mode may not). */
  available: boolean;
  syncNow: () => Promise<void>;
  discard: (seq: number) => Promise<void>;
  /** After a conflict was resolved on the server (PLT-30). */
  conflictResolved: (conflictId: string) => Promise<void>;
  conflictReplaced: (oldId: string, newId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Runs `task` in one tab at a time (T-71); without Web Locks it just runs. */
async function withSyncLock(task: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) await task();
    });
    return;
  }
  await task();
}

/**
 * PLT-28 / PLT-31: the sync engine for the signed-in user, its triggers (online, focus, start,
 * every minute while pending, new items, Background Sync through the service worker) and the
 * queue state the indicator and the sync centre show.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { user, offline, reconnect, status } = useAuth();
  const userId = status === 'signed-in' ? (user?.id ?? null) : null;
  const [browserOnline, setBrowserOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [storage, setStorage] = useState<StorageUse | null>(null);
  const [available, setAvailable] = useState(true);
  const engine = useRef<SyncEngine | null>(null);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    try {
      setItems(await listOutbox(userId));
      setAvailable(true);
    } catch {
      setAvailable(false);
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate().catch(() => null);
      if (estimate) setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
    }
  }, [userId]);

  // One engine per user and device.
  useEffect(() => {
    if (!userId) {
      engine.current = null;
      return;
    }
    const effect = { cancelled: false };
    void deviceId()
      .then((id) => {
        if (effect.cancelled) return;
        engine.current = new SyncEngine({
          store: { list: listOutbox, put: putOutboxItem, readBlob },
          transport: httpTransport(id),
          onSynced: async (item) => {
            if (item.entityType === RESOLUTION_TYPE) {
              // A resolution chosen offline reached the server: close the conflict here too.
              const conflictId = item.entityId.replace(/^conflict:/, '');
              await removeDeviceConflict(item.userId, conflictId);
              await engine.current?.conflictResolved(item.userId, conflictId);
              return;
            }
            await offlineEntity(item.entityType)?.fromServer?.(item);
          },
          onConflict: async (item) => {
            if (!item.conflictId) return;
            const conflict = await authorizedRequest<SyncConflictDto>(
              `/me/sync/conflicts/${item.conflictId}`,
            )
              .then((response) => response.data)
              .catch(() => null);
            await saveDeviceConflict({
              userId: item.userId,
              conflictId: item.conflictId,
              outboxSeq: item.seq ?? null,
              conflict,
              savedAt: Date.now(),
            });
          },
        });
      })
      .catch(() => {
        setAvailable(false);
      });
    return () => {
      effect.cancelled = true;
    };
  }, [userId]);

  const online = browserOnline && !offline;

  const run = useCallback(async () => {
    const current = engine.current;
    if (!userId || !current || !online || running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      await withSyncLock(async () => {
        const result = await current.run(userId);
        if (result.needsSignIn) await reconnect();
        await pruneSynced(userId);
      });
    } finally {
      running.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [userId, online, reconnect, refresh]);

  // Browser connection events.
  useEffect(() => {
    const update = () => {
      setBrowserOnline(navigator.onLine);
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Offline mode ends when the network comes back (PLT-27).
  useEffect(() => {
    if (offline && browserOnline) void reconnect();
  }, [offline, browserOnline, reconnect]);

  // Online start: save the offline profile, then sync (T-73).
  useEffect(() => {
    if (!userId || !user || offline) return;
    void saveOfflineProfile(user).catch(() => undefined);
  }, [userId, user, offline]);

  // Triggers (T-71).
  useEffect(() => {
    if (!userId) return;
    void refresh();
    const wakeAndRun = () => {
      void (async () => {
        await engine.current?.wake(userId);
        await engine.current?.resumeAfterSignIn(userId);
        await run();
      })();
    };
    const timer = setTimeout(wakeAndRun, 500);
    const unsubscribe = onOutboxChange(() => {
      void refresh();
    });
    const onFocus = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'sync') void run();
    };
    window.addEventListener('online', wakeAndRun);
    document.addEventListener('visibilitychange', onFocus);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('online', wakeAndRun);
      document.removeEventListener('visibilitychange', onFocus);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [userId, run, refresh]);

  const counts = useMemo(() => countsOf(items), [items]);
  const pendingCount = counts.pending;

  // Every minute while something waits; a new item is sent at once.
  useEffect(() => {
    if (!userId || pendingCount === 0) return;
    const timer = setInterval(() => {
      void run();
    }, INTERVAL_MS);
    const soon = setTimeout(() => {
      void run();
    }, 300);
    // Background Sync where supported (Chromium): the worker wakes an open tab (T-71).
    void navigator.serviceWorker?.ready
      .then((registration) =>
        (registration as ServiceWorkerRegistration & {
          sync?: { register: (tag: string) => Promise<void> };
        }).sync?.register('hse-sync'),
      )
      .catch(() => undefined);
    return () => {
      clearInterval(timer);
      clearTimeout(soon);
    };
  }, [userId, pendingCount, run]);

  const syncNow = useCallback(async () => {
    if (!userId) return;
    await engine.current?.wake(userId);
    await engine.current?.resumeAfterSignIn(userId);
    await run();
  }, [userId, run]);

  const discard = useCallback(
    async (seq: number) => {
      if (!userId) return;
      await discardItem(userId, seq);
      await refresh();
    },
    [userId, refresh],
  );

  const conflictResolved = useCallback(
    async (conflictId: string) => {
      if (!userId) return;
      await engine.current?.conflictResolved(userId, conflictId);
      await run();
    },
    [userId, run],
  );

  const conflictReplaced = useCallback(
    async (oldId: string, newId: string) => {
      if (!userId) return;
      await engine.current?.conflictReplaced(userId, oldId, newId);
      await refresh();
    },
    [userId, refresh],
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      online,
      syncing,
      items,
      counts,
      storage,
      available,
      syncNow,
      discard,
      conflictResolved,
      conflictReplaced,
      refresh,
    }),
    [online, syncing, items, counts, storage, available, syncNow, discard, conflictResolved, conflictReplaced, refresh],
  );
  return <SyncContext value={value}>{children}</SyncContext>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used inside <SyncProvider>');
  return context;
}
