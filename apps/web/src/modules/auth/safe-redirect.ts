/**
 * Returns `target` only if it is a path on this site, otherwise `/`.
 * Prevents open redirects through `?next=https://evil.example` or `//evil.example`.
 */
export function safeRedirectPath(target: string | null | undefined): string {
  if (!target?.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/';
  return target;
}

export function loginPathFor(currentPath: string): string {
  return currentPath === '/' ? '/login' : `/login?next=${encodeURIComponent(currentPath)}`;
}
