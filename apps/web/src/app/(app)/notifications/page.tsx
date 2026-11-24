import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NotificationsScreen } from '@/modules/notifications/notifications-screen';
import { CompanyOnly } from '@/modules/tenant/company-only';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('notifications'))('title') };
}

/** PLT-17 */
export default function NotificationsPage() {
  return (
    <CompanyOnly>
      <NotificationsScreen />
    </CompanyOnly>
  );
}
