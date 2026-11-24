import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PlatformOnly } from '@/modules/registration/platform-only';
import { RegisterScreen } from '@/modules/registration/register-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('registration'))('title') };
}

export default function RegisterPage() {
  return (
    <PlatformOnly>
      <RegisterScreen />
    </PlatformOnly>
  );
}
