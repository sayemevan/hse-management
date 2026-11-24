import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PlatformOnly } from '@/modules/registration/platform-only';
import { ResubmitScreen } from '@/modules/registration/resubmit-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('registration.resubmit'))('title') };
}

export default function ResubmitPage() {
  return (
    <Suspense>
      <PlatformOnly>
        <ResubmitScreen />
      </PlatformOnly>
    </Suspense>
  );
}
