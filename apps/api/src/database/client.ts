import { drizzle } from 'drizzle-orm/d1';

/**
 * Creates the Drizzle client for a D1 binding.
 *
 * Only repositories may use the returned client (Architecture Rules: database access goes
 * through repositories only). Repositories import their own table definitions, so the
 * client needs no schema registry; Drizzle Kit discovers tables from `*.schema.ts` files
 * (see drizzle.config.ts).
 *
 * D1 has no interactive transactions: use `UnitOfWork` (a `db.batch([...])`) for atomic
 * multi-statement writes. `db.transaction()` must not be used (ADR-001).
 */
export function createDatabase(d1: D1Database) {
  return drizzle(d1);
}

export type Database = ReturnType<typeof createDatabase>;
