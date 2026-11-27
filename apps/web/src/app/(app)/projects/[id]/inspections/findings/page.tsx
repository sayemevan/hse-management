import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { FindingsScreen } from '@/modules/inspections/findings-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('inspections.findings'))('openTitle') };
}

/** US-039: open findings of the project. */
export default function Page() {
  return (
    <Suspense>
      <FindingsScreen />
    </Suspense>
  );
}
