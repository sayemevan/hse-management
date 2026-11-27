import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { CaptureScreen } from '@/modules/inspections/capture-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('inspections.capture'))('title') };
}

/** US-034 – US-036: capture, `?project=&id=`. Works offline (T-80). */
export default function Page() {
  return (
    <CompanyOnly>
      <Suspense>
        <CaptureScreen />
      </Suspense>
    </CompanyOnly>
  );
}
