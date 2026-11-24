import { generateId } from '@hse/shared';
import { sign, verify } from 'hono/jwt';

import { UnauthenticatedError } from '../errors/app-error';
import type { Principal } from './principal';

const ALGORITHM = 'HS256';

export interface TokenSettings {
  secret: string;
  issuer: string;
  audience: string;
  accessTokenTtlSeconds: number;
}

/**
 * Issues and verifies short-lived access tokens (API Rules: JWT authentication).
 *
 * Claims: `sub` (user id), `sid` (session id), `jti`, `iss`, `aud`, `iat`, `exp`.
 * Refresh tokens and server-side session revocation are part of US-001 / US-010 (Sprint 1).
 */
export class TokenService {
  constructor(
    private readonly settings: TokenSettings,
    private readonly clock: () => number = Date.now,
  ) {}

  async issueAccessToken(principal: Principal): Promise<{ token: string; expiresAt: number }> {
    const issuedAt = Math.floor(this.clock() / 1000);
    const expiresAt = issuedAt + this.settings.accessTokenTtlSeconds;
    const token = await sign(
      {
        sub: principal.userId,
        sid: principal.sessionId,
        jti: generateId(),
        iss: this.settings.issuer,
        aud: this.settings.audience,
        iat: issuedAt,
        exp: expiresAt,
      },
      this.settings.secret,
      ALGORITHM,
    );
    return { token, expiresAt: expiresAt * 1000 };
  }

  /** Returns the principal, or throws UnauthenticatedError for any invalid token. */
  async verifyAccessToken(token: string): Promise<Principal> {
    let payload: Record<string, unknown>;
    try {
      payload = await verify(token, this.settings.secret, {
        alg: ALGORITHM,
        iss: this.settings.issuer,
        aud: this.settings.audience,
      });
    } catch {
      throw new UnauthenticatedError();
    }

    const { sub, sid } = payload;
    if (typeof sub !== 'string' || typeof sid !== 'string') {
      throw new UnauthenticatedError();
    }
    return { userId: sub, sessionId: sid };
  }
}
