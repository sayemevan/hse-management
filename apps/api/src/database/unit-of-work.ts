import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from './client';

/** One prepared statement that will run inside an atomic batch. */
export type Statement = BatchItem<'sqlite'>;

/**
 * Collects statements from several repositories and services and runs them as one
 * atomic D1 batch: either every statement succeeds or none does (ADR-001).
 *
 * This is how a business change and its audit record are written together (PLT-01).
 *
 * @example
 * await new UnitOfWork(db)
 *   .add(sessionRepository.revoke(sessionId, 'logout', now))
 *   .add(audit.entry({ action: 'auth.logout', ... }))
 *   .commit();
 */
export class UnitOfWork {
  private readonly statements: Statement[] = [];

  constructor(private readonly db: Database) {}

  add(...statements: Statement[]): this {
    this.statements.push(...statements);
    return this;
  }

  get size(): number {
    return this.statements.length;
  }

  async commit(): Promise<void> {
    const [first, ...rest] = this.statements;
    if (!first) return;
    await this.db.batch([first, ...rest]);
  }
}
