import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RegistrationDetailScreen } from '@/modules/platform/registration-detail-screen';
import { RequireSystemOwner } from '@/modules/platform/require-system-owner';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('platformRegistrations'))('detailTitle') };
}

export default async function RegistrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RequireSystemOwner>
      <RegistrationDetailScreen id={id} />
    </RequireSystemOwner>
  );
}
