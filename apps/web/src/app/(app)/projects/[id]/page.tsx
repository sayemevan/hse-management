import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ProjectScreen } from '@/modules/projects/project-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projects'))('detailTitle') };
}

/** US-016 – US-018: the Overview tab. */
export default function ProjectPage() {
  return <ProjectScreen />;
}
