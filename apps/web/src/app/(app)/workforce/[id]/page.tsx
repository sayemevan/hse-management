import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { CompanyOnly } from '@/modules/tenant/company-only';
import { ProfileScreen } from '@/modules/workforce/profile-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('workforce'))('profileTitle') };
}

/** US-024 – US-030. The API answers 404 to readers who may not see this person. */
export default async function WorkforceProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <CompanyOnly>
      <Suspense>
        <ProfileScreen memberId={id} />
      </Suspense>
    </CompanyOnly>
  );
}
