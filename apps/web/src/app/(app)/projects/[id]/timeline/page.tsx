import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { TimelineScreen } from '@/modules/projects/timeline-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projectTabs'))('timeline') };
}

export default function ProjectTimelinePage() {
  return <TimelineScreen />;
}
