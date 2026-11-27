import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { MyInspectionsScreen } from '@/modules/inspections/my-inspections-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('inspections.mine'))('title') };
}

/** US-033: My inspections. Works offline (T-80). */
export default function Page() {
  return (
    <CompanyOnly>
      <Suspense>
        <MyInspectionsScreen />
      </Suspense>
    </CompanyOnly>
  );
}
