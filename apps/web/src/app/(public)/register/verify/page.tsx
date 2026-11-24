import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PlatformOnly } from '@/modules/registration/platform-only';
import { VerifyEmailScreen } from '@/modules/registration/verify-email-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('registration.verify'))('pageTitle') };
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <PlatformOnly>
        <VerifyEmailScreen />
      </PlatformOnly>
    </Suspense>
  );
}
