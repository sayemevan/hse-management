const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates a primary key (Database Rules: UUID, no business meaning).
 * Uses the Web Crypto API, available in Workers, browsers and Node 22.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
