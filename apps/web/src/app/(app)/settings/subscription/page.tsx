import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { SubscriptionScreen } from '@/modules/billing/subscription-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('subscription'))('title') };
}

/** PLT-13 */
export default function SubscriptionPage() {
  return (
    <RequirePermission permission="subscription.view">
      <SubscriptionScreen />
    </RequirePermission>
  );
}
