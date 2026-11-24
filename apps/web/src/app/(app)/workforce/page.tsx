import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { RequirePermission } from '@/modules/auth/require-permission';
import { DirectoryScreen } from '@/modules/workforce/directory-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('workforce'))('title') };
}

/** US-024 */
export default function WorkforcePage() {
  return (
    <RequirePermission permission="workforce.view">
      <Suspense>
        <DirectoryScreen />
      </Suspense>
    </RequirePermission>
  );
}
