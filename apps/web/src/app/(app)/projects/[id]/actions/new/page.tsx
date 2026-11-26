import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { NewActionScreen } from '@/modules/actions/new-action-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('actions'))('new') };
}

/** US-053 */
export default function NewActionPage() {
  return (
    <Suspense>
      <NewActionScreen />
    </Suspense>
  );
}
