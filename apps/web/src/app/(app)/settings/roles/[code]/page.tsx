import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { RoleScreen } from '@/modules/access/role-screen';
import { RequirePermission } from '@/modules/auth/require-permission';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('rolesAdmin'))('title') };
}

/** US-009 */
export default async function RolePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <RequirePermission permission="roles.view">
      <RoleScreen code={code} />
    </RequirePermission>
  );
}
