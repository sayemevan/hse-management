import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MembersScreen } from '@/modules/projects/members-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projectTabs'))('members') };
}

export default function ProjectMembersPage() {
  return <MembersScreen />;
}
