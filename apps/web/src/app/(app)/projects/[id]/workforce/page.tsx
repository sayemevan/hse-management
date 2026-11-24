import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { ProjectWorkforceScreen } from '@/modules/workforce/project-workforce-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projectTabs'))('workforce') };
}

/** US-025 */
export default function ProjectWorkforcePage() {
  return (
    <Suspense>
      <ProjectWorkforceScreen />
    </Suspense>
  );
}
