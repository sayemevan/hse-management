import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { CompanyPreferencesScreen } from '@/modules/company-admin/company-preferences-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('preferences'))('title') };
}

/** US-013 */
export default function PreferencesPage() {
  return (
    <RequirePermission permission="company.settings.edit">
      <CompanyPreferencesScreen />
    </RequirePermission>
  );
}
