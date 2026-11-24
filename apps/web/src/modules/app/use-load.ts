'use client';

import { useCallback, useEffect, useState } from 'react';

export type LoadState<T> =
  { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; error: unknown };

/**
 * Loads data for a screen. State is only set when the request settles (never synchronously in
 * the effect), and a result is shown only for the `key` it was loaded for, so changing a
 * filter shows "loading" instead of stale rows. `reload()` fetches again.
 *
 * `load` must be stable for a given `key` (wrap it in `useCallback`).
 */
export function useLoad<T>(
  load: () => Promise<T>,
  key: string,
): LoadState<T> & { reload: () => void } {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; state: LoadState<T> } | null>(null);
  const fullKey = `${key}#${String(version)}`;

  useEffect(() => {
    const effect = { cancelled: false };
    load().then(
      (value) => {
        if (!effect.cancelled) setResult({ key: fullKey, state: { status: 'ready', value } });
      },
      (error: unknown) => {
        if (!effect.cancelled) setResult({ key: fullKey, state: { status: 'error', error } });
      },
    );
    return () => {
      effect.cancelled = true;
    };
  }, [load, fullKey]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  const state: LoadState<T> = result?.key === fullKey ? result.state : { status: 'loading' };
  return { ...state, reload };
}
