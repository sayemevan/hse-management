import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { StructureScreen } from '@/modules/projects/structure-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projectTabs'))('structure') };
}

export default function ProjectStructurePage() {
  return <StructureScreen />;
}
