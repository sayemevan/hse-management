import {
  generateId,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  isUuid,
  OFFLINE_LIMITS,
} from '@hse/shared';
import { and, eq, lte } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';

import type { AppEnv, IdempotencyClaim } from '../../core/context/app-context';
import { NotFoundError } from '../../core/errors/app-error';
import { sha256Hex } from '../../core/security/secure-token';
import { createDatabase, type Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { idempotencyKey, type IdempotencyKeyRow } from './sync.schema';
import { IdempotencyKeyInvalidError, IdempotencyKeyReusedError } from './sync.errors';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IdempotentResult {
  companyId: string;
  userId: string;
  resourceType: string;
  resourceId: string;
  statusCode: 200 | 201;
}

/** PLT-29: the stored side of idempotent writes. */
export class IdempotencyService {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  find(companyId: string, key: string): Promise<IdempotencyKeyRow | undefined> {
    return this.db
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.companyId, companyId), eq(idempotencyKey.key, key)))
      .get();
  }

  /** The key row, for the change's `UnitOfWork` (T-69: applied and remembered together). */
  record(claim: IdempotencyClaim, result: IdempotentResult): Statement {
    const now = this.clock();
    return this.db.insert(idempotencyKey).values({
      id: generateId(),
      companyId: result.companyId,
      userId: result.userId,
      key: claim.key,
      method: claim.method,
      route: claim.route,
      requestHash: claim.requestHash,
      statusCode: result.statusCode,
      resourceType: result.resourceType,
      resourceId: result.resourceId,
      createdAt: new Date(now),
      expiresAt: new Date(now + OFFLINE_LIMITS.idempotencyKeyDays * DAY_MS),
    });
  }

  /** O-124: the daily job removes expired keys. */
  async purgeExpired(): Promise<number> {
    const removed = await this.db
      .delete(idempotencyKey)
      .where(lte(idempotencyKey.expiresAt, new Date(this.clock())))
      .returning({ id: idempotencyKey.id })
      .all();
    return removed.length;
  }
}

/** The claim on this request, if any: services pass it to `IdempotencyService.record`. */
export function idempotencyClaimOf(c: Context<AppEnv>): IdempotencyClaim | undefined {
  return c.get('idempotency');
}

/** SHA-256 over method, route and the body (multipart: fields and each file's hash). */
export async function requestHash(c: Context<AppEnv>, route: string): Promise<string> {
  const raw = c.req.raw.clone();
  const contentType = c.req.header('content-type') ?? '';
  let body: string;
  if (contentType.startsWith('multipart/form-data')) {
    const form = await raw.formData();
    const parts: string[] = [];
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') {
        parts.push(`${name}=${value}`);
      } else {
        const bytes = new Uint8Array(await value.arrayBuffer());
        parts.push(`${name}#${String(bytes.byteLength)}#${await sha256Hex(bytes)}`);
      }
    }
    body = parts.sort().join('\n');
  } else {
    body = await raw.text();
  }
  return sha256Hex(`${c.req.method}\n${route}\n${body}`);
}

function isUniqueKeyClash(error: unknown): boolean {
  const text = String((error as { message?: unknown } | null)?.message ?? error);
  return text.includes('UNIQUE') && text.includes('idempotency_key');
}

export interface IdempotentOptions {
  /** Reads the resource for a replay, with the route's own access checks. */
  read: (c: Context<AppEnv>, resourceId: string) => Promise<unknown>;
  companyIdOf: (c: Context<AppEnv>) => string;
}

/**
 * PLT-29 (T-69). Put after authentication on offline-capable write routes. Without the header
 * the route works as before. A repeat of a known key replays the result without running the
 * handler; the same key with another body or user is refused; two copies racing make the second
 * batch fail on the unique index, and it replays.
 */
export function idempotent(options: IdempotentOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (key === undefined) {
      await next();
      return;
    }
    if (!isUuid(key)) throw new IdempotencyKeyInvalidError();

    const db = createDatabase(c.env.DB);
    const keys = new IdempotencyService(db);
    const companyId = options.companyIdOf(c);
    const userId = c.get('principal').userId;
    const route = c.req.routePath;
    const hash = await requestHash(c, route);

    const replay = async (row: IdempotencyKeyRow) => {
      if (row.userId !== userId || row.requestHash !== hash) throw new IdempotencyKeyReusedError();
      const data = await options.read(c, row.resourceId);
      if (data === undefined || data === null) throw new NotFoundError();
      // Built by hand: on the race path the context already holds the error response.
      return new Response(JSON.stringify({ success: true, message: 'Already applied', data }), {
        status: row.statusCode === 201 ? 201 : 200,
        headers: {
          'content-type': 'application/json',
          [IDEMPOTENT_REPLAYED_HEADER]: 'true',
        },
      });
    };

    const existing = await keys.find(companyId, key);
    if (existing) return replay(existing);

    c.set('idempotency', { key, method: c.req.method, route, requestHash: hash });
    await next();

    if (c.error && isUniqueKeyClash(c.error)) {
      const winner = await keys.find(companyId, key);
      if (winner) {
        c.error = undefined;
        c.res = await replay(winner);
      }
    }
    return undefined;
  };
}
