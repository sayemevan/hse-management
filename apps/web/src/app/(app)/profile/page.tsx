import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ProfileScreen } from '@/modules/profile/profile-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('profile'))('title') };
}

/** US-007 */
export default function ProfilePage() {
  return <ProfileScreen />;
}
