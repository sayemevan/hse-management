import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PaymentDetailScreen } from '@/modules/platform/payment-detail-screen';
import { RequireSystemOwner } from '@/modules/platform/require-system-owner';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('platformPayments'))('detailTitle') };
}

/** PLT-14 */
export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequireSystemOwner>
      <PaymentDetailScreen id={id} />
    </RequireSystemOwner>
  );
}
