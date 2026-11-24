import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { CompanyInformationScreen } from '@/modules/company-admin/company-information-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('companyInfo'))('pageTitle') };
}

/** US-015 */
export default function CompanyPage() {
  return (
    <RequirePermission permission="company.view">
      <CompanyInformationScreen />
    </RequirePermission>
  );
}
