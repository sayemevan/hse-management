import type { Logger } from '../../core/logging/logger';
import type { Database } from '../../database/client';
import { SessionRepository } from './session.repository';

/**
 * Daily housekeeping (US-010 FR-5): forget refresh-token hashes of sessions that have ended.
 * Expiry itself is enforced on every request, so this only reduces stored secrets.
 */
export async function purgeEndedSessionTokens(
  db: Database,
  logger: Logger,
  now: number = Date.now(),
): Promise<number> {
  const cleaned = await new SessionRepository(db).purgeEndedTokenHashes(now);
  logger.info('ended session tokens purged', { sessions: cleaned });
  return cleaned;
}
