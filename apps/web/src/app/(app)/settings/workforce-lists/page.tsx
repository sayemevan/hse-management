import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { WorkforceListsScreen } from '@/modules/workforce/lists-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('workforce.lists'))('title') };
}

/** PLT-21 */
export default function WorkforceListsPage() {
  return (
    <RequirePermission permission="workforce.lists.manage">
      <WorkforceListsScreen />
    </RequirePermission>
  );
}
