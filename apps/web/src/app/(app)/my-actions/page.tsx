import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { MyActionsScreen } from '@/modules/actions/my-actions-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('actions.mine'))('title') };
}

/** PLT-24 */
export default function MyActionsPage() {
  return (
    <CompanyOnly>
      <Suspense>
        <MyActionsScreen />
      </Suspense>
    </CompanyOnly>
  );
}
