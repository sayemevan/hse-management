'use client';

import { useEffect } from 'react';

/**
 * PLT-25 FR-5 / O-125: forms report unsaved input so an app update never reloads under the
 * user's hands. A counter, because several forms may be open.
 */
let dirtyForms = 0;

export function hasUnsavedChanges(): boolean {
  return dirtyForms > 0;
}

/** Call in a form with whether it holds input that isn't saved yet. */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    dirtyForms += 1;
    return () => {
      dirtyForms -= 1;
    };
  }, [dirty]);
}
