import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RequirePermission } from '@/modules/auth/require-permission';
import { UsersScreen } from '@/modules/users/users-screen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('users'))('title') };
}

/** US-006 */
export default function UsersPage() {
  return (
    <RequirePermission permission="users.view">
      <UsersScreen />
    </RequirePermission>
  );
}
