import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ProjectsScreen } from '@/modules/projects/projects-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projects'))('title') };
}

/** US-016 */
export default function ProjectsPage() {
  return (
    <CompanyOnly>
      <ProjectsScreen />
    </CompanyOnly>
  );
}
