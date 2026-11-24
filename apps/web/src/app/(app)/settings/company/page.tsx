import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { CompanyProfileScreen } from '@/modules/company-admin/company-profile-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('companySettings'))('title') };
}

/** US-012, US-014 */
export default function CompanySettingsPage() {
  return (
    <RequirePermission permission="company.edit">
      <CompanyProfileScreen />
    </RequirePermission>
  );
}
