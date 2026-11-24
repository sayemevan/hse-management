import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PaymentQueueScreen } from '@/modules/platform/payment-queue-screen';
import { RequireSystemOwner } from '@/modules/platform/require-system-owner';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('platformPayments'))('title') };
}

/** PLT-14 */
export default function PaymentQueuePage() {
  return (
    <RequireSystemOwner>
      <Suspense>
        <PaymentQueueScreen />
      </Suspense>
    </RequireSystemOwner>
  );
}
