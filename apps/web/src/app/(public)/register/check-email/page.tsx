import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CheckEmailScreen } from '@/modules/registration/check-email-screen';
import { PlatformOnly } from '@/modules/registration/platform-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('registration.checkEmail'))('title') };
}

export default function CheckEmailPage() {
  return (
    <PlatformOnly>
      <CheckEmailScreen />
    </PlatformOnly>
  );
}
