import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ChangePasswordScreen } from '@/modules/auth/change-password-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('changePassword'))('title') };
}

export default function ChangePasswordPage() {
  return <ChangePasswordScreen />;
}
