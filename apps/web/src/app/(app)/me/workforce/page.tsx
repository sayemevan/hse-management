import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { CompanyOnly } from '@/modules/tenant/company-only';
import { ProfileScreen } from '@/modules/workforce/profile-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('workforce'))('mineTitle') };
}

/** O-85: the signed-in user's own workforce record, read-only. */
export default function MyWorkforcePage() {
  return (
    <CompanyOnly>
      <Suspense>
        <ProfileScreen mine />
      </Suspense>
    </CompanyOnly>
  );
}
