import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { NewPersonScreen } from '@/modules/workforce/person-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('workforce'))('newTitle') };
}

/** US-024 flow 2 */
export default function NewPersonPage() {
  return (
    <RequirePermission permission="workforce.manage">
      <NewPersonScreen />
    </RequirePermission>
  );
}
