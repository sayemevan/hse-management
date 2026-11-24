import { describe, expect, it } from 'vitest';

import { PasswordHasher } from '../src/core/auth/password-hasher';
import { TokenService } from '../src/core/auth/token-service';
import { UnauthenticatedError } from '../src/core/errors/app-error';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher(10_000);

  it('verifies the original password and rejects others', async () => {
    const stored = await hasher.hash('Correct-Horse-9');

    expect(stored.startsWith('pbkdf2$sha256$10000$')).toBe(true);
    await expect(hasher.verify('Correct-Horse-9', stored)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(hasher.verify('wrong-password', stored)).resolves.toMatchObject({
      valid: false,
    });
  });

  it('salts every hash', async () => {
    expect(await hasher.hash('same')).not.toBe(await hasher.hash('same'));
  });

  it('flags hashes created with fewer iterations for rehash', async () => {
    const legacy = await new PasswordHasher(10_000).hash('secret-value');
    const verification = await new PasswordHasher(20_000).verify('secret-value', legacy);
    expect(verification).toEqual({ valid: true, needsRehash: true });
  });

  it('treats malformed stored hashes as invalid', async () => {
    await expect(hasher.verify('x', 'not-a-hash')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});

describe('TokenService', () => {
  const settings = {
    secret: 'test-secret-that-is-long-enough-for-hs256-signing',
    issuer: 'hse-api',
    audience: 'hse-web',
    accessTokenTtlSeconds: 60,
  };
  const principal = { userId: 'user-1', sessionId: 'session-1' };

  it('round-trips a principal', async () => {
    const service = new TokenService(settings);
    const { token } = await service.issueAccessToken(principal);
    await expect(service.verifyAccessToken(token)).resolves.toEqual(principal);
  });

  it('rejects expired tokens', async () => {
    const issuedLongAgo = new TokenService(settings, () => Date.now() - 3_600_000);
    const { token } = await issuedLongAgo.issueAccessToken(principal);
    await expect(new TokenService(settings).verifyAccessToken(token)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('rejects tokens for another audience or secret', async () => {
    const { token } = await new TokenService({ ...settings, audience: 'other' }).issueAccessToken(
      principal,
    );
    await expect(new TokenService(settings).verifyAccessToken(token)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );

    const forged = await new TokenService({
      ...settings,
      secret: 'another-secret-that-is-also-long-enough',
    }).issueAccessToken(principal);
    await expect(new TokenService(settings).verifyAccessToken(forged.token)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});
