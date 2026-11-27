import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { StartInspectionScreen } from '@/modules/inspections/start-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('inspections.startScreen'))('title') };
}

/** US-033: start an inspection on the spot. Works offline (T-80). */
export default function Page() {
  return (
    <CompanyOnly>
      <Suspense>
        <StartInspectionScreen />
      </Suspense>
    </CompanyOnly>
  );
}
