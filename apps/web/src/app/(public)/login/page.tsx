import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { LoginScreen } from '@/modules/auth/login-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('login'))('title') };
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
