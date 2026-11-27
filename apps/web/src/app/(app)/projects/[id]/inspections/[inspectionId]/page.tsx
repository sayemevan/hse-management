import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { InspectionScreen } from '@/modules/inspections/inspection-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('inspections.page'))('title') };
}

/** US-037 – US-039: the inspection page. */
export default function Page() {
  return (
    <Suspense>
      <InspectionScreen />
    </Suspense>
  );
}
