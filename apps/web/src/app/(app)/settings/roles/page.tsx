import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RolesScreen } from '@/modules/access/roles-screen';
import { RequirePermission } from '@/modules/auth/require-permission';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('rolesAdmin'))('title') };
}

/** US-009 */
export default function RolesPage() {
  return (
    <RequirePermission permission="roles.view">
      <RolesScreen />
    </RequirePermission>
  );
}
