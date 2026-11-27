import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PublicPage } from '@/components/layout/public-page';
import { OfflinePage } from '@/modules/offline/offline-page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('offline.notice'))('title') };
}

/** PLT-25 FR-4: served by the service worker for pages that are not on the device. */
export default function OfflineRoute() {
  return (
    <PublicPage>
      <OfflinePage />
    </PublicPage>
  );
}
