import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { UserDetailScreen } from '@/modules/access/user-detail-screen';
import { RequirePermission } from '@/modules/auth/require-permission';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('userAccess'))('title') };
}

/** US-008 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="users.view">
      <UserDetailScreen id={id} />
    </RequirePermission>
  );
}
