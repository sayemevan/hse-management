import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SessionsScreen } from '@/modules/auth/sessions-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('sessions'))('title') };
}

export default function SessionsPage() {
  return <SessionsScreen />;
}
