import { generateSecureToken, sha256Hex } from '../../core/security/secure-token';

/** A random, opaque refresh token (T-1). Only its hash is stored. */
export const generateRefreshToken = generateSecureToken;

export const hashRefreshToken = sha256Hex;
