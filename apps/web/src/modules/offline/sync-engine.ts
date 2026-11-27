import { ErrorCode, syncBackoffMs } from '@hse/shared';

import type { BlobRow, OutboxError, OutboxItem } from './device-store';

/** What came back for one item (the transport hides fetch, tokens and headers). */
export type SendOutcome =
  | { kind: 'ok'; status: number; data: unknown }
  | { kind: 'network' }
  | { kind: 'http'; status: number; code: string; params?: Record<string, string | number> };

export type Disposition = 'synced' | 'retry' | 'sign_in' | 'read_only' | 'conflict' | 'attention';

const SESSION_CODES = new Set<string>([
  ErrorCode.SESSION_EXPIRED,
  ErrorCode.UNAUTHENTICATED,
  ErrorCode.ACCOUNT_INACTIVE,
]);

/** T-71: how each answer moves an item. */
export function classify(outcome: SendOutcome): Disposition {
  if (outcome.kind === 'ok') return 'synced';
  if (outcome.kind === 'network') return 'retry';
  const { status, code } = outcome;
  if (status === 0 || status >= 500 || status === 429) return 'retry';
  if (status === 401 || SESSION_CODES.has(code)) return 'sign_in';
  if (code === ErrorCode.SUBSCRIPTION_READ_ONLY) return 'read_only';
  if (status === 409 && code === ErrorCode.SYNC_CONFLICT) return 'conflict';
  return 'attention';
}

export interface SyncStore {
  list(userId: string): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  readBlob(id: string): Promise<BlobRow | undefined>;
}

export interface SyncTransport {
  send(item: OutboxItem, blob: BlobRow | undefined): Promise<SendOutcome>;
}

export interface SyncEngineOptions {
  store: SyncStore;
  transport: SyncTransport;
  now?: () => number;
  /** T-71: at most this many records at once. */
  maxParallel?: number;
  onSynced?: (item: OutboxItem) => Promise<void> | void;
  onConflict?: (item: OutboxItem) => Promise<void> | void;
}

export interface RunResult {
  sent: number;
  /** The session ended: the queue waits for the same user to sign in (PLT-27). */
  needsSignIn: boolean;
}

/** O-126: a read-only company is retried at this pace. */
const READ_ONLY_RETRY_MS = 15 * 60 * 1000;
/** An item left "sending" by a closed tab is sent again after this long. */
const STALE_SENDING_MS = 2 * 60 * 1000;
export const DEPENDENCY_CODE = 'DEPENDENCY_NEEDS_ATTENTION';

/**
 * PLT-28 (T-71): drains one user's outbox in order. Items of one record go one at a time in
 * `seq` order; an item waits for its `dependsOn`; up to three records are sent in parallel.
 * The caller runs this under a Web Lock so only one tab syncs.
 */
export class SyncEngine {
  private readonly now: () => number;
  private readonly maxParallel: number;

  constructor(private readonly options: SyncEngineOptions) {
    this.now = options.now ?? Date.now;
    this.maxParallel = options.maxParallel ?? 3;
  }

  /** Items that may be sent right now, at most one per record. */
  eligible(items: OutboxItem[]): OutboxItem[] {
    const now = this.now();
    const bySeq = new Map(items.map((item) => [item.seq, item]));
    const headOfRecord = new Set<number>();
    const seenRecords = new Set<string>();
    for (const item of items) {
      if (item.state === 'synced' || seenRecords.has(item.entityId)) continue;
      seenRecords.add(item.entityId);
      if (item.seq !== undefined) headOfRecord.add(item.seq);
    }
    const result: OutboxItem[] = [];
    for (const item of items) {
      if (item.seq === undefined || !headOfRecord.has(item.seq)) continue;
      const stale = item.state === 'sending' && now - item.nextAttemptAt > STALE_SENDING_MS;
      if (item.state !== 'pending' && item.state !== 'waiting_read_only' && !stale) continue;
      if (item.nextAttemptAt > now && !stale) continue;
      if (item.dependsOn !== null) {
        const dependency = bySeq.get(item.dependsOn);
        // A missing dependency was synced and pruned (a discard removes dependents too).
        if (dependency && dependency.state !== 'synced') continue;
      }
      result.push(item);
      if (result.length >= this.maxParallel) break;
    }
    return result;
  }

  async run(userId: string): Promise<RunResult> {
    const result: RunResult = { sent: 0, needsSignIn: false };
    for (;;) {
      const items = await this.options.store.list(userId);
      const batch = this.eligible(items);
      if (batch.length === 0) return result;
      const outcomes = await Promise.all(batch.map((item) => this.sendOne(item)));
      result.sent += batch.length;
      if (outcomes.includes('sign_in')) {
        result.needsSignIn = true;
        return result;
      }
      // Nothing moved forward (every item was refused or must wait): stop this run.
      if (!outcomes.includes('synced')) return result;
    }
  }

  private async sendOne(item: OutboxItem): Promise<Disposition> {
    const store = this.options.store;
    await store.put({ ...item, state: 'sending', nextAttemptAt: this.now() });
    const blob = item.blobId ? await store.readBlob(item.blobId) : undefined;
    let outcome: SendOutcome;
    try {
      outcome = await this.options.transport.send(item, blob);
    } catch {
      outcome = { kind: 'network' };
    }
    const disposition = classify(outcome);
    const now = this.now();
    const attempts = item.attempts + 1;
    const error: OutboxError | null =
      outcome.kind === 'http'
        ? { status: outcome.status, code: outcome.code, ...(outcome.params ? { params: outcome.params } : {}) }
        : outcome.kind === 'network'
          ? { status: 0, code: ErrorCode.SERVICE_UNAVAILABLE }
          : null;

    switch (disposition) {
      case 'synced': {
        const data = outcome.kind === 'ok' ? outcome.data : null;
        const synced: OutboxItem = {
          ...item,
          state: 'synced',
          attempts,
          lastError: null,
          syncedAt: now,
          result: data,
        };
        await store.put(synced);
        await this.rebase(item, data);
        await this.options.onSynced?.(synced);
        break;
      }
      case 'retry':
        await store.put({
          ...item,
          state: 'pending',
          attempts,
          lastError: error,
          nextAttemptAt: now + syncBackoffMs(attempts),
        });
        break;
      case 'sign_in':
        await store.put({ ...item, state: 'waiting_sign_in', lastError: error, nextAttemptAt: now });
        break;
      case 'read_only':
        await store.put({
          ...item,
          state: 'waiting_read_only',
          attempts,
          lastError: error,
          nextAttemptAt: now + READ_ONLY_RETRY_MS,
        });
        break;
      case 'conflict': {
        const conflictId =
          outcome.kind === 'http' && outcome.params?.conflictId !== undefined
            ? String(outcome.params.conflictId)
            : null;
        const conflicted: OutboxItem = { ...item, state: 'conflict', attempts, lastError: error, conflictId };
        await store.put(conflicted);
        await this.options.onConflict?.(conflicted);
        break;
      }
      case 'attention':
        await store.put({ ...item, state: 'needs_attention', attempts, lastError: error });
        await this.blockDependents(item);
        break;
    }
    return disposition;
  }

  /** Later edits of the same record from this device apply on top of the new version. */
  private async rebase(item: OutboxItem, data: unknown): Promise<void> {
    const version =
      typeof data === 'object' && data !== null && typeof (data as { version?: unknown }).version === 'number'
        ? (data as { version: number }).version
        : null;
    if (version === null) return;
    const later = (await this.options.store.list(item.userId)).filter(
      (other) =>
        other.entityId === item.entityId &&
        (other.seq ?? 0) > (item.seq ?? 0) &&
        other.state !== 'synced' &&
        other.request.baseVersionField,
    );
    for (const other of later) {
      const field = other.request.baseVersionField ?? 'baseVersion';
      await this.options.store.put({
        ...other,
        request: { ...other.request, body: { ...other.request.body, [field]: version } },
      });
    }
  }

  private async blockDependents(item: OutboxItem): Promise<void> {
    if (item.seq === undefined) return;
    const items = await this.options.store.list(item.userId);
    const wanted = new Set([item.seq]);
    for (const other of items) {
      if (other.dependsOn === null || !wanted.has(other.dependsOn) || other.seq === undefined) continue;
      wanted.add(other.seq);
      if (other.state === 'synced') continue;
      await this.options.store.put({
        ...other,
        state: 'needs_attention',
        lastError: { status: 0, code: DEPENDENCY_CODE },
      });
    }
  }

  /** The connection came back or the user pressed Sync now: no more waiting (T-71). */
  async wake(userId: string): Promise<void> {
    const now = this.now();
    for (const item of await this.options.store.list(userId)) {
      if (item.state === 'pending' || item.state === 'waiting_read_only') {
        await this.options.store.put({ ...item, nextAttemptAt: now });
      }
    }
  }

  /** PLT-27: the same user signed in again. */
  async resumeAfterSignIn(userId: string): Promise<void> {
    const now = this.now();
    for (const item of await this.options.store.list(userId)) {
      if (item.state === 'waiting_sign_in') {
        await this.options.store.put({ ...item, state: 'pending', nextAttemptAt: now });
      }
    }
  }

  /** PLT-30: the conflict was resolved on the server; the item is done, dependents go on. */
  async conflictResolved(userId: string, conflictId: string): Promise<void> {
    for (const item of await this.options.store.list(userId)) {
      if (item.state === 'conflict' && item.conflictId === conflictId) {
        await this.options.store.put({ ...item, state: 'synced', syncedAt: this.now(), lastError: null });
      }
    }
  }

  /** A conflict was replaced by a newer one (the record changed again). */
  async conflictReplaced(userId: string, oldId: string, newId: string): Promise<void> {
    for (const item of await this.options.store.list(userId)) {
      if (item.state === 'conflict' && item.conflictId === oldId) {
        await this.options.store.put({ ...item, conflictId: newId });
      }
    }
  }
}
