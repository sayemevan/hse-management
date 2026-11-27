import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { SyncCentreScreen } from '@/modules/offline/sync-centre-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('offline.centre'))('title') };
}

/** PLT-31 (and PLT-30: `?conflict={id}` opens the conflict review). Works offline. */
export default function SyncPage() {
  return (
    <CompanyOnly>
      <Suspense>
        <SyncCentreScreen />
      </Suspense>
    </CompanyOnly>
  );
}
