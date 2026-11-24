import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RequireSystemOwner } from '@/modules/platform/require-system-owner';
import { SubscriptionsOverviewScreen } from '@/modules/platform/subscriptions-overview-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('platformSubscriptions'))('title') };
}

/** PLT-14 FR-7 */
export default function SubscriptionsOverviewPage() {
  return (
    <RequireSystemOwner>
      <Suspense>
        <SubscriptionsOverviewScreen />
      </Suspense>
    </RequireSystemOwner>
  );
}
