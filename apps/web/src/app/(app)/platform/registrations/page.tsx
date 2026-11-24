import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RegistrationQueueScreen } from '@/modules/platform/registration-queue-screen';
import { RequireSystemOwner } from '@/modules/platform/require-system-owner';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('platformRegistrations'))('title') };
}

export default function RegistrationQueuePage() {
  return (
    <RequireSystemOwner>
      <Suspense>
        <RegistrationQueueScreen />
      </Suspense>
    </RequireSystemOwner>
  );
}
