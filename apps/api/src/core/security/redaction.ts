/**
 * Removes secrets from values before they are logged or written to the audit log.
 * One implementation shared by the logger and the audit service.
 */
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential|hash/i;
export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Returns a deep copy of `value` with sensitive keys replaced and errors serialized. */
export function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value, depth);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (Array.isArray(value)) return value.map((item: unknown) => redact(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1);
  }
  return result;
}

function serializeError(error: Error, depth: number): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause !== undefined ? { cause: redact(error.cause, depth + 1) } : {}),
  };
}
