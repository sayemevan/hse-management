import { eq } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { userPreference } from './identity.schema';

/** Per-user values that aren't profile fields (PLT-19). The only code touching the table. */
export class UserPreferences {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  async lastProjectId(userId: string): Promise<string | null> {
    const row = await this.db
      .select({ lastProjectId: userPreference.lastProjectId })
      .from(userPreference)
      .where(eq(userPreference.userId, userId))
      .get();
    return row?.lastProjectId ?? null;
  }

  /** PLT-19 FR-3. Not audited: navigation, not a business change. */
  async setLastProject(userId: string, projectId: string): Promise<void> {
    const updatedAt = new Date(this.clock());
    await this.db
      .insert(userPreference)
      .values({ userId, lastProjectId: projectId, updatedAt })
      .onConflictDoUpdate({
        target: userPreference.userId,
        set: { lastProjectId: projectId, updatedAt },
      })
      .run();
  }
}
