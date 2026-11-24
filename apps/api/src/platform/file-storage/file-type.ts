/**
 * Detects a file's real type from its first bytes (PLT-07 FR-3). The name and the
 * declared content type are never trusted.
 */
const SIGNATURES: readonly { type: string; test: (bytes: Uint8Array) => boolean }[] = [
  {
    type: 'image/png',
    test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { type: 'image/jpeg', test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    type: 'image/webp',
    // "RIFF" <size> "WEBP"
    test: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  { type: 'application/pdf', test: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/** The detected MIME type, or null when the content matches no known signature. */
export function detectFileType(head: Uint8Array): string | null {
  return SIGNATURES.find((signature) => signature.test(head))?.type ?? null;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * A file name safe to store and to send in `Content-Disposition`: no path, no control
 * characters, at most 200 characters, and an extension that matches the real type.
 */
export function cleanFileName(name: string, contentType: string): string {
  const base =
    name
      .split(/[/\\]/)
      .pop()
      ?.replace(/[\p{Cc}"]/gu, '')
      .trim() ?? '';
  const extension = EXTENSIONS[contentType] ?? 'bin';
  const stem = base.replace(/\.[^.]*$/, '').slice(0, 190) || 'file';
  return `${stem}.${extension}`;
}
