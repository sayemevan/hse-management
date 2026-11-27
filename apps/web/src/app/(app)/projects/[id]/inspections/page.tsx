import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ProjectInspectionsScreen } from '@/modules/inspections/project-inspections-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projectTabs'))('inspections') };
}

/** US-033: the project's Inspections tab. */
export default function Page() {
  return (
    <Suspense>
      <ProjectInspectionsScreen />
    </Suspense>
  );
}
