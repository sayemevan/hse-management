'use client';

import type { PlaceSelection } from '@hse/shared';
import { useState } from 'react';

import { PlacePicker } from './place-picker';
import { useCurrentProject } from './project-context';

/** Development-only page for trying the place picker (US-021 user flow "Pick"). */
export function PlacePickerDemo() {
  const { project } = useCurrentProject();
  const [value, setValue] = useState<PlaceSelection>({});
  return (
    <div className="flex flex-col gap-4">
      <PlacePicker projectId={project.id} value={value} onChange={setValue} />
      <pre dir="ltr" className="rounded-lg bg-muted p-3 text-sm">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
