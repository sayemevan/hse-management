import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ProjectActionsScreen } from '@/modules/actions/project-actions-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projectTabs'))('actions') };
}

/** PLT-24 */
export default function ProjectActionsPage() {
  return (
    <Suspense>
      <ProjectActionsScreen />
    </Suspense>
  );
}
