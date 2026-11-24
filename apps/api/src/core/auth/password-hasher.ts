/**
 * Password hashing with WebCrypto PBKDF2-SHA-256 (native to Workers; see ADR-001).
 *
 * Stored format (self-describing, so parameters can be raised without a migration):
 *   pbkdf2$sha256$<iterations>$<salt base64url>$<hash base64url>
 *
 * `verify` reports `needsRehash` when a stored hash uses weaker parameters than the
 * current configuration, so the caller can transparently upgrade it after a successful login.
 */
const ALGORITHM_ID = 'pbkdf2';
const DIGEST_ID = 'sha256';
const SALT_BYTES = 16;
const KEY_BITS = 256;

export interface PasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

export class PasswordHasher {
  constructor(private readonly iterations: number) {
    if (!Number.isInteger(iterations) || iterations <= 0) {
      throw new RangeError('iterations must be a positive integer');
    }
  }

  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const derived = await derive(password, salt, this.iterations);
    return [
      ALGORITHM_ID,
      DIGEST_ID,
      String(this.iterations),
      toBase64Url(salt),
      toBase64Url(derived),
    ].join('$');
  }

  async verify(password: string, stored: string): Promise<PasswordVerification> {
    const parsed = parse(stored);
    if (!parsed) return { valid: false, needsRehash: false };

    const derived = await derive(password, parsed.salt, parsed.iterations);
    const valid = constantTimeEqual(derived, parsed.hash);
    return { valid, needsRehash: valid && parsed.iterations < this.iterations };
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

function parse(stored: string): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null {
  const [algorithm, digest, iterationsText, saltText, hashText, ...rest] = stored.split('$');
  if (algorithm !== ALGORITHM_ID || digest !== DIGEST_ID || rest.length > 0) return null;
  if (!iterationsText || !saltText || !hashText) return null;

  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;

  try {
    return { iterations, salt: fromBase64Url(saltText), hash: fromBase64Url(hashText) };
  } catch {
    return null;
  }
}

/** Compares in time independent of where the first difference is. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
